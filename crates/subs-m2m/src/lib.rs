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
use std::sync::OnceLock;

use ct2rs::sys::Translator as Ct2Translator;
use ct2rs::tokenizers::sentencepiece::Tokenizer;
use ct2rs::{Config, Tokenizer as _, TranslationOptions};
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
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

impl M2mTranslator {
    /// One translation per input, each input on its own. The model sees no
    /// context beyond the string it is given.
    fn translate_each(&self, texts: &[String], source: &str, target: &str) -> Result<Vec<String>, TranslateError> {
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
                    .map(|t| without_spelled_unk(&t).trim().to_string())
                    .map_err(|e| TranslateError::Backend(format!("decoding: {e}")))
            })
            .collect()
    }
}

impl Translator for M2mTranslator {
    /// Translates sentence by sentence, not cue by cue.
    ///
    /// Cues are cut by time, so most of them end mid-sentence: "That's the"
    /// at the end of one, "whole idea." at the start of the next. Given one
    /// such fragment on its own, the model either drops it ("That's the"
    /// came back as nothing) or copies the dangling words through
    /// untranslated, so a cue showed English beside Chinese. So the cues of one
    /// sentence are joined, translated once, and the translation is shared
    /// back over those cues in proportion to how much of the sentence each
    /// one held. Timings are untouched -- only the text inside each cue is
    /// replaced, as before -- but a cue may now carry words the speaker says
    /// a moment before or after it, which is the usual trade in subtitle
    /// translation and a far smaller error than a missing clause.
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

        let units = sentence_units(texts);
        let joined: Vec<String> = units
            .iter()
            .map(|u| u.iter().map(|(_, piece)| piece.as_str()).collect::<Vec<_>>().join(" "))
            .collect();
        let translated = self.translate_each(&joined, &source, &target)?;

        let script = Script::of(&req.target);
        let unspaced = writes_without_spaces(&target);
        let mut out: Vec<Vec<String>> = vec![Vec::new(); texts.len()];
        for (unit, text) in units.iter().zip(translated) {
            let text = script.normalise(&text);
            let weights: Vec<usize> = unit.iter().map(|(_, piece)| weight(piece)).collect();
            let cut_points = word_boundaries(&text, &target, unspaced);
            for ((cue, _), part) in unit.iter().zip(distribute(&text, &weights, &cut_points)) {
                if !part.is_empty() {
                    out[*cue].push(part);
                }
            }
        }
        let joiner = if unspaced { "" } else { " " };
        Ok(out.into_iter().map(|parts| parts.join(joiner)).collect())
    }
}

/// The model sometimes writes its unknown-word marker out as ordinary
/// text -- the pieces "<", "unk", ">" (or "»") -- which no token filter
/// catches, and which reached a subtitle as "为 <unk»". It is never a
/// translation of anything, so it is removed with the space around it.
fn without_spelled_unk(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("<unk") {
        out.push_str(rest[..at].trim_end());
        let mut after = &rest[at + "<unk".len()..];
        after = after.strip_prefix('>').or_else(|| after.strip_prefix('»')).unwrap_or(after);
        let after = after.trim_start();
        // A space only where it separates two words of a spaced script.
        let joins_words = out.chars().last().is_some_and(|c| c.is_ascii_alphanumeric())
            && after.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
        if joins_words {
            out.push(' ');
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

/// At most this many cues are joined into one piece of text for the model.
/// Speech with no sentence punctuation at all -- song lyrics, a transcript
/// whose recogniser does not punctuate -- would otherwise run on as one
/// "sentence" for the whole clip, and the model does worst on long input.
const MAX_UNIT_CUES: usize = 3;
/// And at most about this many characters of source text.
const MAX_UNIT_CHARS: usize = 220;

/// The cues' text regrouped into sentences: each unit is a run of
/// `(cue index, piece of that cue's text)`, in order. A cue's text appears
/// in one unit, or is split between the end of one and the start of the
/// next where a sentence ends inside it.
fn sentence_units(texts: &[String]) -> Vec<Vec<(usize, String)>> {
    let mut units: Vec<Vec<(usize, String)>> = Vec::new();
    let mut current: Vec<(usize, String)> = Vec::new();
    for (i, text) in texts.iter().enumerate() {
        let text = text.replace('\n', " ");
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let cues_in_current = {
            let mut seen: Vec<usize> = current.iter().map(|(c, _)| *c).collect();
            seen.dedup();
            seen.len()
        };
        let chars_in_current: usize = current.iter().map(|(_, p)| p.chars().count()).sum();
        if !current.is_empty()
            && (cues_in_current >= MAX_UNIT_CUES || chars_in_current + text.chars().count() > MAX_UNIT_CHARS)
        {
            units.push(std::mem::take(&mut current));
        }
        for (piece, ends_sentence) in split_sentences(text) {
            current.push((i, piece));
            if ends_sentence {
                units.push(std::mem::take(&mut current));
            }
        }
    }
    if !current.is_empty() {
        units.push(current);
    }
    units
}

/// A cue's text cut after each sentence-final mark that is followed by a
/// space, with whether each piece ends a sentence. "99.9%" and "3.5" are
/// not cut: a sentence end is a mark *then a space*.
fn split_sentences(text: &str) -> Vec<(String, bool)> {
    const ENDS: &[char] = &['.', '!', '?', '…', '。', '！', '？'];
    let chars: Vec<char> = text.chars().collect();
    let mut pieces = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        if ENDS.contains(&chars[i]) {
            // A run of marks, then any closing quotes or brackets, is one end.
            let mut j = i + 1;
            while j < chars.len() && (ENDS.contains(&chars[j]) || "\"'”’)」』".contains(chars[j])) {
                j += 1;
            }
            let at_end = j == chars.len();
            if at_end || chars[j].is_whitespace() || "。！？".contains(chars[i]) {
                let piece: String = chars[start..j].iter().collect::<String>().trim().to_string();
                if !piece.is_empty() {
                    pieces.push((piece, true));
                }
                start = j;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    let rest: String = chars[start..].iter().collect::<String>().trim().to_string();
    if !rest.is_empty() {
        pieces.push((rest, false));
    }
    pieces
}

/// How much of a sentence a piece of source text is: its letters and digits.
fn weight(piece: &str) -> usize {
    piece.chars().filter(|c| c.is_alphanumeric()).count().max(1)
}

/// Languages written without spaces between words: a translation into one
/// of them can be cut between any two characters, and the parts are joined
/// back with nothing between them.
fn writes_without_spaces(m2m: &str) -> bool {
    matches!(m2m, "zh" | "ja" | "th" | "lo" | "km" | "my")
}

/// Where a translation may be cut without splitting a word: before a space
/// in a spaced language, between the words a Chinese segmenter finds in
/// Chinese, and anywhere in the other unspaced scripts. `ok[k]` is whether a
/// cut before character `k` is allowed; both ends always are.
fn word_boundaries(text: &str, m2m_target: &str, unspaced: bool) -> Vec<bool> {
    let chars: Vec<char> = text.trim().chars().collect();
    let len = chars.len();
    let mut ok = vec![!unspaced; len + 1];
    if !unspaced {
        for (k, c) in chars.iter().enumerate() {
            ok[k] = *c == ' ';
        }
    } else if m2m_target == "zh" {
        // "这就是整个想法" cut by proportion alone came out as "这就是整" and
        // "个想法": the cut fell inside 整个. jieba's dictionary knows the
        // words, so a cut is moved to the nearest gap between two of them.
        let mut ok_zh = vec![false; len + 1];
        for token in segmenter().cut(&chars.iter().collect::<String>(), true) {
            if token.end <= len {
                ok_zh[token.end] = true;
            }
        }
        ok = ok_zh;
    }
    ok[0] = true;
    ok[len] = true;
    ok
}

fn segmenter() -> &'static jieba_rs::Jieba {
    static JIEBA: OnceLock<jieba_rs::Jieba> = OnceLock::new();
    JIEBA.get_or_init(jieba_rs::Jieba::new)
}

/// Share one translated sentence among the pieces of source it came from,
/// in proportion to their weights. A cut goes just after a punctuation mark
/// when there is one close to the proportional point, otherwise to the
/// nearest place `cut_points` allows, so a word is not split across two
/// cues; only a sentence with no such place at all is cut by count alone.
fn distribute(text: &str, weights: &[usize], cut_points: &[bool]) -> Vec<String> {
    if weights.len() <= 1 {
        return vec![text.trim().to_string()];
    }
    let chars: Vec<char> = text.trim().chars().collect();
    let len = chars.len();
    let total: usize = weights.iter().sum();
    let is_mark = |c: char| "，。、；：！？,.;:!?)」』”".contains(c);
    let allowed = |k: usize| cut_points.get(k).copied().unwrap_or(k == 0 || k == len);
    // How far from the proportional point a punctuation mark may pull the cut.
    let reach: usize = (len / 8).clamp(3, 12);

    let mut cuts = Vec::with_capacity(weights.len() + 1);
    cuts.push(0);
    let mut so_far = 0;
    let pieces = weights.len();
    for (k, w) in weights[..pieces - 1].iter().enumerate() {
        so_far += w;
        let floor = *cuts.last().unwrap();
        // Every piece keeps at least one character when there are enough to
        // go round: an empty part would leave its cue with no translation,
        // and an untranslated cue falls back to the source text.
        let left_after = pieces - 1 - k;
        let (min_cut, max_cut) = if len >= pieces { (floor + 1, len - left_after) } else { (floor, len) };
        let max_cut = max_cut.max(min_cut);
        let ideal = ((len * so_far + total / 2) / total).clamp(min_cut, max_cut);
        let lo = ideal.saturating_sub(reach).max(min_cut);
        let hi = (ideal + reach).min(max_cut);
        let after_mark = (lo..=hi).filter(|&j| j > 0 && is_mark(chars[j - 1])).min_by_key(|&j| j.abs_diff(ideal));
        let between_words = || (min_cut..=max_cut).filter(|&j| allowed(j)).min_by_key(|&j| j.abs_diff(ideal));
        let cut = after_mark.or_else(between_words).unwrap_or(ideal);
        cuts.push(cut.max(floor));
    }
    cuts.push(len);
    cuts.windows(2).map(|w| chars[w[0]..w[1]].iter().collect::<String>().trim().to_string()).collect()
}

/// Which script a Chinese translation must come out in.
///
/// M2M-100 has one Chinese, `__zh__`, and nothing in the request says which
/// script: trained on both, it answers in a mix -- "這個挑戰, 我們的成員" in
/// a Simplified target, beside whole cues in Simplified. The text is converted to the script the user
/// asked for with OpenCC's tables (Apache-2.0), phrase by phrase rather
/// than character by character, so that "頭髮" and "發展" each become the
/// right Simplified word.
enum Script {
    Unchanged,
    Convert(BuiltinConfig),
}

impl Script {
    fn of(target: &str) -> Self {
        let t = target.to_ascii_lowercase().replace('_', "-");
        if !(t == "zh" || t.starts_with("zh-")) {
            return Script::Unchanged;
        }
        if t.contains("hant") || t.ends_with("-tw") || t.ends_with("-hk") || t.ends_with("-mo") {
            // Taiwan's standard forms for plain Traditional: OpenCC's own
            // standard writes 爲 and 綫 where a reader of Traditional
            // Chinese expects 為 and 線.
            if t.ends_with("-hk") || t.ends_with("-mo") {
                Script::Convert(BuiltinConfig::S2hk)
            } else {
                Script::Convert(BuiltinConfig::S2tw)
            }
        } else if t.contains("hans") || t.ends_with("-cn") || t.ends_with("-sg") {
            Script::Convert(BuiltinConfig::T2s)
        } else {
            // Bare "zh" names no script; leave the model's choice alone.
            Script::Unchanged
        }
    }

    fn normalise(&self, text: &str) -> String {
        match self {
            Script::Unchanged => text.to_string(),
            Script::Convert(config) => match converter(*config) {
                Some(cc) => cc.convert(text),
                None => text.to_string(),
            },
        }
    }
}

/// Loading a converter reads its dictionaries; each is built once.
fn converter(config: BuiltinConfig) -> Option<&'static OpenCC> {
    static T2S: OnceLock<Option<OpenCC>> = OnceLock::new();
    static S2TW: OnceLock<Option<OpenCC>> = OnceLock::new();
    static S2HK: OnceLock<Option<OpenCC>> = OnceLock::new();
    let cell = match config {
        BuiltinConfig::T2s => &T2S,
        BuiltinConfig::S2hk => &S2HK,
        _ => &S2TW,
    };
    cell.get_or_init(|| OpenCC::from_config(config).ok()).as_ref()
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

    fn words(units: &[Vec<(usize, String)>]) -> Vec<Vec<(usize, &str)>> {
        units.iter().map(|u| u.iter().map(|(c, p)| (*c, p.as_str())).collect()).collect()
    }

    #[test]
    fn a_sentence_ends_at_a_mark_followed_by_a_space_not_inside_a_number() {
        assert_eq!(
            split_sentences("99.9%. Nothing here is uploaded. That's the"),
            vec![("99.9%.".to_string(), true), ("Nothing here is uploaded.".to_string(), true), ("That's the".to_string(), false)]
        );
        assert_eq!(split_sentences("\"burned into the picture\". This"), vec![("\"burned into the picture\".".to_string(), true), ("This".to_string(), false)]);
        assert_eq!(split_sentences("no mark at all"), vec![("no mark at all".to_string(), false)]);
    }

    #[test]
    fn a_sentence_cut_by_a_cue_boundary_is_translated_as_one() {
        let cues: Vec<String> = ["Nothing here is uploaded. That's the", "whole idea.", "Next."].map(String::from).to_vec();
        assert_eq!(
            words(&sentence_units(&cues)),
            vec![vec![(0, "Nothing here is uploaded.")], vec![(0, "That's the"), (1, "whole idea.")], vec![(2, "Next.")]]
        );
    }

    #[test]
    fn speech_with_no_punctuation_is_joined_three_cues_at_a_time() {
        let cues: Vec<String> = (0..7).map(|i| format!("lyric line {i} and on")).collect();
        let units = sentence_units(&cues);
        let spans: Vec<Vec<usize>> = units.iter().map(|u| u.iter().map(|(c, _)| *c).collect()).collect();
        assert_eq!(spans, vec![vec![0, 1, 2], vec![3, 4, 5], vec![6]]);
    }

    #[test]
    fn an_empty_cue_belongs_to_no_sentence() {
        let cues: Vec<String> = ["one and", "", "two."].map(String::from).to_vec();
        assert_eq!(words(&sentence_units(&cues)), vec![vec![(0, "one and"), (2, "two.")]]);
    }

    #[test]
    fn a_chinese_sentence_is_shared_without_cutting_a_word() {
        let text = "这就是整个想法。";
        let parts = distribute(text, &[8, 9], &word_boundaries(text, "zh", true));
        assert_eq!(parts, vec!["这就是", "整个想法。"]);
    }

    #[test]
    fn a_cut_moves_to_punctuation_close_by() {
        let text = "让我们看看本季度的燃烧率，然后再做别的事情。";
        let parts = distribute(text, &[18, 22], &word_boundaries(text, "zh", true));
        assert_eq!(parts[0], "让我们看看本季度的燃烧率，", "{parts:?}");
    }

    #[test]
    fn a_spaced_translation_is_cut_between_words() {
        let text = "Esa es toda la idea.";
        let parts = distribute(text, &[8, 9], &word_boundaries(text, "es", false));
        assert_eq!(parts.len(), 2);
        assert_eq!(parts.join(" "), text);
        assert!(parts.iter().all(|p| !p.is_empty() && !p.starts_with(' ')));
    }

    #[test]
    fn every_cue_gets_some_of_the_sentence() {
        // A short fragment at the end of a sentence still gets a part: an
        // empty one would fall back to the English source.
        let text = "这就是整个想法。";
        for weights in [[1, 40], [40, 1], [3, 3]] {
            let parts = distribute(text, &weights, &word_boundaries(text, "zh", true));
            assert!(parts.iter().all(|p| !p.is_empty()), "{weights:?} -> {parts:?}");
            assert_eq!(parts.concat(), text);
        }
    }

    #[test]
    fn simplified_is_asked_for_and_simplified_comes_out() {
        let mixed = "這個挑戰, 我們的成員與 OpenSubs 一起";
        assert_eq!(Script::of("zh-Hans").normalise(mixed), "这个挑战, 我们的成员与 OpenSubs 一起");
        assert_eq!(Script::of("zh-CN").normalise("頭髮"), "头发");
        assert_eq!(Script::of("zh-Hant").normalise("头发和发展为线"), "頭髮和發展為線");
        // No script named, or not Chinese: left as the model wrote it.
        assert_eq!(Script::of("zh").normalise(mixed), mixed);
        assert_eq!(Script::of("ja").normalise("写真に焼かれた"), "写真に焼かれた");
    }

    #[test]
    fn a_spelled_out_unknown_word_marker_is_removed() {
        assert_eq!(without_spelled_unk("我们为 <unk> 准备了 <unk» 晚饭"), "我们为准备了晚饭");
        assert_eq!(without_spelled_unk("la <unk> idea"), "la idea");
        assert_eq!(without_spelled_unk("nothing to remove"), "nothing to remove");
    }

    #[test]
    fn cues_cut_mid_sentence_come_back_whole_and_in_one_script() {
        let Some(m2m) = model() else { return };
        // Cue text as the segmenter cut it from a real recording.
        let cues: Vec<String> = [
            "the words \"burned into the picture\". This",
            "line is deliberately long enough that",
            "it has to wrap onto a second line. 99.9%. Nothing here is uploaded. That's the",
            "whole idea.",
        ]
        .map(String::from)
        .to_vec();
        let out = m2m.translate(&cues, &TranslateRequest::to("zh-Hans").from_language("en")).unwrap();
        assert_eq!(out.len(), cues.len());
        let t2s = converter(BuiltinConfig::T2s).unwrap();
        for (src, t) in cues.iter().zip(&out) {
            assert!(has_cjk(t), "{src:?} -> {t:?}");
            assert!(!t.chars().any(|c| c.is_ascii_alphabetic()), "English left in: {src:?} -> {t:?}");
            assert_eq!(t2s.convert(t), *t, "Traditional characters in a Simplified target: {t}");
        }
    }

    #[test]
    fn the_repeat_detector_sees_a_loop() {
        assert!(longest_repeat("加加加加加") >= 3);
        assert!(longest_repeat("加油，加油，加油，加油，") >= 3);
        assert!(longest_repeat("早上好，今天我们要做饭。") < 3);
    }
}
