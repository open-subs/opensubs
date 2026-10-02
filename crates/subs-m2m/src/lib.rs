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

use std::path::Path;

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
        let spm_path = dir.join("sentencepiece.bpe.model");
        let spm = Tokenizer::from_file(&spm_path, &spm_path)
            .map_err(|e| TranslateError::Backend(format!("loading the tokenizer: {e}")))?;
        let model = Ct2Translator::new(dir, &Config::default())
            .map_err(|e| TranslateError::Backend(format!("loading {}: {e}", dir.display())))?;
        Ok(Self { model, spm })
    }
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
        let options = TranslationOptions { beam_size: 2, max_decoding_length: 256, ..Default::default() };
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
