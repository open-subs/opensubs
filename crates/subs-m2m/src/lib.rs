//! Translation with no network: M2M-100 418M, int8, through CTranslate2.
//!
//! The desktop app's only translator was Claude, on the user's own key, so
//! offline it could not translate at all. M2M-100 is MIT-licensed -- NLLB,
//! the better model, is non-commercial and cannot ship in a product that
//! sells anything -- covers 100 languages, and at int8 is ~470 MB. It is
//! weaker than a hosted model, more literal, and now and then leaves a
//! word it does not know; the paid route and Claude remain for quality.
//!
//! M2M-100 is told both languages: the source as a token in front of the
//! text (`__en__`), the target as the first token of the output (`__ja__`).

use std::path::{Path, PathBuf};

use ct2rs::sys::Translator as Ct2Translator;
use ct2rs::tokenizers::sentencepiece::Tokenizer;
use ct2rs::{Config, Tokenizer as _, TranslationOptions};
use subs_translate::{TranslateError, TranslateRequest, Translator};

pub struct M2mTranslator {
    model: Ct2Translator,
    spm: Tokenizer,
}

impl M2mTranslator {
    /// `dir` holds the converted model: model.bin, config.json,
    /// shared_vocabulary.json and sentencepiece.bpe.model.
    pub fn new(dir: &Path) -> Result<Self, TranslateError> {
        let dir = native_dir(dir);
        let spm_path = dir.join("sentencepiece.bpe.model");
        let spm = Tokenizer::from_file(&spm_path, &spm_path)
            .map_err(|e| TranslateError::Backend(format!("loading the tokenizer: {e}")))?;
        let model = Ct2Translator::new(&dir, &Config::default())
            .map_err(|e| TranslateError::Backend(format!("loading {}: {e}", dir.display())))?;
        Ok(Self { model, spm })
    }
}

/// The model directory as CTranslate2 must be given it on Windows: without
/// the `\\?\` verbatim prefix.
///
/// The desktop app finds the model under Tauri's resource directory, which
/// is built from a canonicalized executable path and so arrives as
/// `\\?\C:\...\models\m2m100`. CTranslate2 opens `dir + "/model.bin"`,
/// and inside a verbatim path Windows does not turn `/` into a separator:
/// it looks for a file literally named `m2m100/model.bin` and fails with
/// "Unable to open file 'model.bin'", although the file is there. `dunce`
/// drops the prefix only when the plain form means the same file, and
/// leaves every other path, and every path off Windows, as it was.
fn native_dir(dir: &Path) -> PathBuf {
    dunce::simplified(dir).to_path_buf()
}

/// The codes M2M-100 knows, in the form its language tokens use. Subtags
/// are dropped ("zh-Hans" -> "zh", "pt-BR" -> "pt"); M2M-100 has one of each.
fn m2m_code(code: &str) -> String {
    code.split(['-', '_']).next().unwrap_or(code).to_lowercase()
}

impl Translator for M2mTranslator {
    fn translate(&self, texts: &[String], req: &TranslateRequest) -> Result<Vec<String>, TranslateError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let source = req
            .source
            .as_deref()
            .filter(|s| *s != "auto")
            .map(m2m_code)
            .unwrap_or_else(|| "en".into());
        let target = m2m_code(&req.target);
        if source == target {
            return Ok(texts.to_vec());
        }
        let source_tag = format!("__{source}__");
        let target_tag = format!("__{target}__");
        // The language tags are tokens of their own. Written into the text
        // instead, sentencepiece splits them into pieces of ordinary words
        // and the model reads them as part of the sentence -- and echoes it.
        let mut batch = Vec::with_capacity(texts.len());
        for text in texts {
            let mut tokens = vec![source_tag.clone()];
            tokens.extend(
                self.spm
                    .encode(&text.replace('\n', " "))
                    .map_err(|e| TranslateError::Backend(format!("tokenising: {e}")))?,
            );
            batch.push(tokens);
        }
        let prefixes: Vec<Vec<String>> = texts.iter().map(|_| vec![target_tag.clone()]).collect();
        // Never the same three tokens twice. Without it, a cue the model
        // finds hard -- a sentence cut mid-way by the cue boundary, which
        // most cues are -- can fall into a loop: "加加加…" or "加油，加油，…"
        // until max_decoding_length, the rest of the sentence never
        // reached. Subtitles have no legitimate use for a repeated trigram.
        let options = TranslationOptions {
            beam_size: 2,
            no_repeat_ngram_size: 3,
            max_decoding_length: 256,
            ..Default::default()
        };
        let results = self
            .model
            .translate_batch_with_target_prefix(&batch, &prefixes, &options, None)
            .map_err(|e| TranslateError::Backend(format!("translating: {e}")))?;
        results
            .into_iter()
            .map(|r| {
                let tokens: Vec<String> = r
                    .hypotheses
                    .into_iter()
                    .next()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|t| t != &target_tag && t != "</s>" && t != "<unk>")
                    .collect();
                self.spm
                    .decode(tokens)
                    .map(|t| t.trim().to_string())
                    .map_err(|e| TranslateError::Backend(format!("decoding: {e}")))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The model the desktop installer carries. It is not in the
    /// repository (~470 MB), so these tests pass vacuously without it;
    /// `OPENSUBS_M2M_DIR` points them at another copy, and
    /// `OPENSUBS_REQUIRE_M2M=1` makes a missing model a failure instead.
    fn model_dir() -> Option<PathBuf> {
        let dir = std::env::var_os("OPENSUBS_M2M_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/src-tauri/bundled/models/m2m100")
            });
        if !dir.join("model.bin").exists() {
            assert!(
                std::env::var_os("OPENSUBS_REQUIRE_M2M").is_none(),
                "OPENSUBS_REQUIRE_M2M is set but there is no M2M-100 model at {}",
                dir.display()
            );
            eprintln!("skipping: no M2M-100 model at {}", dir.display());
            return None;
        }
        Some(dir)
    }

    fn model() -> Option<M2mTranslator> {
        Some(M2mTranslator::new(&model_dir()?).expect("load the model"))
    }

    fn has_cjk(s: &str) -> bool {
        s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
    }

    /// The longest run of one short piece repeated back to back.
    fn longest_repeat(s: &str) -> usize {
        let c: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
        let mut best = 1;
        for width in 1..=4 {
            for start in 0..c.len() {
                let mut n = 1;
                while start + (n + 1) * width <= c.len()
                    && c[start..start + width] == c[start + n * width..start + (n + 1) * width]
                {
                    n += 1;
                }
                best = best.max(n);
            }
        }
        best
    }

    #[test]
    fn a_cue_cut_mid_sentence_is_translated_rather_than_looped() {
        let Some(m2m) = model() else { return };
        // Cue text as the segmenter produces it: the end of one sentence,
        // a whole one, and the start of the next. The 2-beam decoder used
        // to answer this with one character repeated to the length limit.
        let cue = "some oil in the pan. Add the garlic and stir for one minute. Finally, serve the food";
        let out = m2m
            .translate(&[cue.to_string()], &TranslateRequest::to("zh-Hans").from_language("en"))
            .unwrap();
        assert!(has_cjk(&out[0]), "not translated: {}", out[0]);
        assert!(longest_repeat(&out[0]) < 3, "looped: {}", out[0]);
        assert!(out[0].chars().count() < cue.chars().count(), "runaway output: {}", out[0]);
    }

    #[test]
    fn plain_english_comes_back_in_the_target_script() {
        let Some(m2m) = model() else { return };
        let lines: Vec<String> = [
            "Good morning everyone. Today we are going to cook a",
            "simple dinner. First, wash the vegetables and cut them into small pieces.",
            "while it is still hot.",
        ]
        .map(String::from)
        .to_vec();
        let out = m2m.translate(&lines, &TranslateRequest::to("zh-Hans").from_language("en")).unwrap();
        assert_eq!(out.len(), lines.len());
        for (src, t) in lines.iter().zip(&out) {
            assert!(has_cjk(t), "left in English: {src:?} -> {t:?}");
            assert!(longest_repeat(t) < 3, "looped: {t}");
        }
    }

    #[test]
    fn an_ordinary_model_dir_reaches_ctranslate2_unchanged() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join("m2m100");
        assert_eq!(native_dir(&dir), dir);
    }

    /// The directory exactly as the Windows installer leaves it and the
    /// desktop app resolves it: per-user, under %LOCALAPPDATA%.
    #[cfg(windows)]
    #[test]
    fn a_verbatim_model_dir_reaches_ctranslate2_without_its_prefix() {
        let resolved = Path::new(r"\\?\C:\Users\someone\AppData\Local\OpenSubs\models\m2m100");
        let handed_over = native_dir(resolved);
        assert_eq!(handed_over, Path::new(r"C:\Users\someone\AppData\Local\OpenSubs\models\m2m100"));
        assert!(!handed_over.to_string_lossy().starts_with(r"\\?\"));
    }

    /// The real model, opened through a verbatim path made the way Tauri
    /// makes its resource directory: `std::fs::canonicalize`. CTranslate2
    /// given that path itself cannot find model.bin; through
    /// `M2mTranslator::new` it loads and translates.
    #[cfg(windows)]
    #[test]
    fn the_model_loads_and_translates_from_a_verbatim_path() {
        let Some(dir) = model_dir() else { return };
        let verbatim = std::fs::canonicalize(&dir).unwrap();
        assert!(verbatim.to_string_lossy().starts_with(r"\\?\"), "not verbatim: {}", verbatim.display());
        assert!(verbatim.join("model.bin").is_file(), "model.bin is missing from {}", verbatim.display());

        let unaided = Ct2Translator::new(&verbatim, &Config::default())
            .err()
            .expect("CTranslate2 opened model.bin through a verbatim path; the premise of this test no longer holds");
        assert!(unaided.to_string().contains("Unable to open file 'model.bin'"), "{unaided}");
        eprintln!("CTranslate2 given {} directly: {unaided}", verbatim.display());

        let m2m = M2mTranslator::new(&verbatim).expect("load the model from a verbatim path");
        let out = m2m
            .translate(&["Good morning everyone.".to_string()], &TranslateRequest::to("zh-Hans").from_language("en"))
            .unwrap();
        assert!(has_cjk(&out[0]), "not translated: {}", out[0]);
        eprintln!("M2mTranslator::new({}) translated: {}", verbatim.display(), out[0]);
    }

    #[test]
    fn the_repeat_detector_sees_a_loop() {
        assert!(longest_repeat("加加加加加") >= 3);
        assert!(longest_repeat("加油，加油，加油，加油，") >= 3);
        assert!(longest_repeat("早上好，今天我们要做饭。") < 3);
    }
}
