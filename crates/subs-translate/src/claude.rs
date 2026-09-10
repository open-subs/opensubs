//! Translation via the Claude Messages API.
//!
//! Rust has no official Anthropic SDK, so this is the documented raw-HTTP
//! path: `POST https://api.anthropic.com/v1/messages`.
//!
//! Request building and response parsing are pure functions, tested on
//! literal JSON, in the same spirit as `subs-media`'s argv builders --
//! the network is one thin layer at the bottom, behind the `http` feature,
//! and everything that can be got wrong is testable without it.

use crate::{TranslateError, TranslateRequest};
use serde_json::{json, Value};

pub const API_URL: &str = "https://api.anthropic.com/v1/messages";
pub const API_VERSION: &str = "2023-06-01";

/// The default model. Translation is mechanical work, but subtitle
/// translation is unusually unforgiving -- it has to survive a hard line
/// budget and stay idiomatic in the target script -- so this is not a place
/// to reach for a smaller model by default.
pub const DEFAULT_MODEL: &str = "claude-opus-5";

/// Output cap. Translations run about the length of their input, and
/// [`crate::MAX_BATCH`] keeps one request to a few dozen short cues, so
/// this has a wide margin over anything a batch can produce while staying
/// under the non-streaming HTTP timeout.
const MAX_TOKENS: u32 = 16000;

/// What the model is asked to be.
///
/// The two rules that are not obvious to a general-purpose translator, and
/// that subtitles fail on when they are missing: the output has to stay
/// *short enough to read in the time available*, and the count must come
/// back exactly, because each string is pinned to a timestamp that is not
/// being re-derived.
pub const SYSTEM: &str = "\
You translate video subtitles. You are given the subtitle lines of one clip, \
in order, as a JSON array of strings.

Return a JSON object with a \"translations\" array holding exactly one \
translation per input string, in the same order. Never merge, split, \
reorder, drop or add entries: entry N of your output is displayed at the \
timestamp of entry N of the input, so a count mismatch desynchronises the \
whole clip.

Translate for a viewer reading at speed:
- Keep each translation roughly as long as the original, and never much \
longer. A subtitle that is too long to read in its slot is a worse \
translation than a slightly plainer one that fits.
- Use natural spoken register, not literal word-for-word rendering.
- Preserve proper nouns, numbers, and technical terms.
- Keep sentence-final punctuation; do not add narration, notes, brackets, \
or explanations.
- The lines are consecutive speech from one clip, so use the surrounding \
entries as context for pronouns and continuing sentences.
- If an entry cannot be translated (it is a sound, a name alone, or already \
in the target language), return it unchanged rather than describing it.";

/// The JSON schema the response is constrained to.
fn response_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "translations": {
                "type": "array",
                "items": { "type": "string" }
            }
        },
        "required": ["translations"],
        "additionalProperties": false
    })
}

/// Build the request body for one batch.
pub fn build_request(texts: &[String], req: &TranslateRequest, model: &str) -> Value {
    let target = crate::language::resolve(&req.target);
    let source = req
        .source
        .as_deref()
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("auto"))
        .map(crate::language::resolve);

    let instruction = match source {
        Some(src) => format!("Translate these subtitle lines from {src} into {target}."),
        None => format!("Translate these subtitle lines into {target}."),
    };

    let payload = json!({ "lines": texts });

    json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM,
        // Structured outputs rather than a prefill: assistant prefills are
        // rejected outright on this model family, and a schema is a firmer
        // guarantee than asking for JSON in prose.
        "output_config": {
            // Mechanical, well-specified work. Effort buys nothing here and
            // this runs once per batch on every export.
            "effort": "low",
            "format": {
                "type": "json_schema",
                "schema": response_schema()
            }
        },
        "messages": [{
            "role": "user",
            "content": format!("{instruction}\n\n{payload}")
        }]
    })
}

/// Headers for the request, as (name, value) pairs.
pub fn build_headers(api_key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("content-type", "application/json".to_string()),
        ("x-api-key", api_key.to_string()),
        ("anthropic-version", API_VERSION.to_string()),
    ]
}

/// Pull the translations out of a Messages API response body.
pub fn parse_response(body: &str, expected: usize) -> Result<Vec<String>, TranslateError> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| TranslateError::Parse(format!("response was not JSON: {e}")))?;

    // An API-level error comes back as a JSON body with a different shape,
    // not always as a non-200 status.
    if v.get("type").and_then(Value::as_str) == Some("error") {
        let msg = v
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("unknown API error");
        return Err(TranslateError::Backend(msg.to_string()));
    }

    // A refusal is HTTP 200 with content that does not answer the request,
    // so it has to be checked before the content blocks are read.
    if v.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
        let category = v
            .pointer("/stop_details/category")
            .and_then(Value::as_str)
            .unwrap_or("unspecified");
        return Err(TranslateError::Refused(category.to_string()));
    }

    let text = v
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(|b| b.get("text").and_then(Value::as_str))
        .ok_or_else(|| TranslateError::Parse("response carried no text block".into()))?;

    parse_translations(text, expected)
}

/// Parse the model's own output: `{"translations": [...]}`.
///
/// Split out from [`parse_response`] because the schema the model answers
/// in and the envelope the provider wraps it in are two different things.
/// Anthropic returns `content: [{type: "text", ...}]`; an OpenAI-compatible
/// server returns `choices[0].message.content`. Both carry the same object,
/// and the rules for reading it — including the count check that keeps cues
/// pinned to their timestamps — must not be written twice and drift.
pub fn parse_translations(
    model_output: &str,
    expected: usize,
) -> Result<Vec<String>, TranslateError> {
    let parsed: Value = serde_json::from_str(model_output).map_err(|e| {
        TranslateError::Parse(format!("model output was not the requested JSON: {e}"))
    })?;

    let items = parsed
        .get("translations")
        .and_then(Value::as_array)
        .ok_or_else(|| TranslateError::Parse("no \"translations\" array in model output".into()))?;

    let out: Vec<String> = items
        .iter()
        .map(|i| i.as_str().unwrap_or_default().to_string())
        .collect();

    if out.len() != expected {
        return Err(TranslateError::CountMismatch {
            sent: expected,
            got: out.len(),
        });
    }

    Ok(out)
}

/// Read the API key from the environment.
///
/// `ANTHROPIC_API_KEY` is the documented variable and the one every other
/// Anthropic tool reads, so a user who has already set it up for anything
/// else needs no further configuration here.
pub fn api_key_from_env() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

#[cfg(feature = "http")]
mod client {
    use super::*;
    use crate::Translator;
    use std::time::Duration;

    /// Calls the Claude Messages API over HTTP.
    pub struct ClaudeTranslator {
        api_key: String,
        model: String,
        client: reqwest::blocking::Client,
    }

    impl ClaudeTranslator {
        /// Fails when no key is configured, rather than at request time --
        /// a missing key should be reported before a long transcription
        /// runs, not after it.
        pub fn from_env() -> Result<Self, TranslateError> {
            let key = api_key_from_env().ok_or_else(|| {
                TranslateError::Auth(
                    "ANTHROPIC_API_KEY is not set. Translation calls the Claude API with \
                     your own key, at your own cost -- nothing is charged by this app."
                        .into(),
                )
            })?;
            Ok(Self::with_key(key))
        }

        pub fn with_key(api_key: impl Into<String>) -> Self {
            Self {
                api_key: api_key.into(),
                model: DEFAULT_MODEL.to_string(),
                client: reqwest::blocking::Client::builder()
                    // Generous: a batch of dense cues on a busy endpoint is
                    // still a single request, and failing it means failing
                    // an export the user has already waited for.
                    .timeout(Duration::from_secs(300))
                    .build()
                    .unwrap_or_default(),
            }
        }

        pub fn with_model(mut self, model: impl Into<String>) -> Self {
            self.model = model.into();
            self
        }
    }

    impl Translator for ClaudeTranslator {
        fn translate(
            &self,
            texts: &[String],
            req: &TranslateRequest,
        ) -> Result<Vec<String>, TranslateError> {
            if texts.is_empty() {
                return Ok(Vec::new());
            }

            let body = build_request(texts, req, &self.model);
            let mut request = self.client.post(API_URL);
            for (name, value) in build_headers(&self.api_key) {
                request = request.header(name, value);
            }

            // Serialised here rather than via reqwest's `json` helper, which
            // would pull in a feature this crate does not otherwise need.
            // The content-type header is already set by `build_headers`.
            let response = request
                .body(body.to_string())
                .send()
                .map_err(|e| TranslateError::Backend(format!("request failed: {e}")))?;

            let status = response.status();
            let text = response
                .text()
                .map_err(|e| TranslateError::Backend(format!("could not read response: {e}")))?;

            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                return Err(TranslateError::Auth(format!(
                    "the Claude API rejected the key ({status})"
                )));
            }

            // A non-2xx still carries a JSON error body worth surfacing, so
            // parse first and let parse_response name the actual problem.
            match parse_response(&text, texts.len()) {
                Ok(v) => Ok(v),
                Err(e) if !status.is_success() => Err(TranslateError::Backend(format!(
                    "the Claude API returned {status}: {e}"
                ))),
                Err(e) => Err(e),
            }
        }
    }
}

#[cfg(feature = "http")]
pub use client::ClaudeTranslator;

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> TranslateRequest {
        TranslateRequest::to("ja")
    }

    fn texts() -> Vec<String> {
        vec!["Hello there".into(), "How are you".into()]
    }

    #[test]
    fn the_request_names_the_model_and_caps_output() {
        let b = build_request(&texts(), &req(), DEFAULT_MODEL);
        assert_eq!(b["model"], DEFAULT_MODEL);
        assert_eq!(b["max_tokens"], MAX_TOKENS);
    }

    #[test]
    fn the_response_is_constrained_by_a_schema_rather_than_asked_for_in_prose() {
        let b = build_request(&texts(), &req(), DEFAULT_MODEL);
        assert_eq!(b["output_config"]["format"]["type"], "json_schema");
        assert_eq!(
            b["output_config"]["format"]["schema"]["required"][0],
            "translations"
        );
        // Prefills are rejected on this model family; the last message must
        // be the user's.
        let messages = b["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
    }

    #[test]
    fn the_prompt_carries_the_target_language_by_name_and_every_line() {
        let b = build_request(&texts(), &req(), DEFAULT_MODEL);
        let content = b["messages"][0]["content"].as_str().unwrap();
        assert!(content.contains("Japanese"), "{content}");
        assert!(content.contains("Hello there"));
        assert!(content.contains("How are you"));
    }

    #[test]
    fn a_known_source_language_is_named_but_auto_is_not() {
        let mut r = req();
        r.source = Some("zh-Hans".into());
        let named = build_request(&texts(), &r, DEFAULT_MODEL);
        assert!(named["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("from Chinese (Simplified)"));

        // "auto" is what the ASR layer reports when it was not told a
        // language; passing it through as a source would be a lie.
        r.source = Some("auto".into());
        let auto = build_request(&texts(), &r, DEFAULT_MODEL);
        assert!(!auto["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("from auto"));
    }

    #[test]
    fn the_lines_are_sent_as_json_so_punctuation_cannot_confuse_the_boundary() {
        let awkward = vec!["line one\nline two".to_string(), "\"quoted\"".to_string()];
        let b = build_request(&awkward, &req(), DEFAULT_MODEL);
        let content = b["messages"][0]["content"].as_str().unwrap();
        // The payload half must round-trip as JSON.
        let start = content.find('{').unwrap();
        let payload: Value = serde_json::from_str(&content[start..]).unwrap();
        assert_eq!(payload["lines"][0], "line one\nline two");
        assert_eq!(payload["lines"][1], "\"quoted\"");
    }

    #[test]
    fn headers_carry_the_key_and_the_api_version() {
        let h = build_headers("sk-test");
        assert!(h.contains(&("x-api-key", "sk-test".to_string())));
        assert!(h.contains(&("anthropic-version", API_VERSION.to_string())));
    }

    #[test]
    fn a_well_formed_response_yields_the_translations() {
        let body = r#"{
            "type": "message",
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": "{\"translations\":[\"こんにちは\",\"元気ですか\"]}"}]
        }"#;
        assert_eq!(
            parse_response(body, 2).unwrap(),
            vec!["こんにちは".to_string(), "元気ですか".to_string()]
        );
    }

    #[test]
    fn a_thinking_block_before_the_text_block_does_not_confuse_the_parser() {
        let body = r#"{
            "stop_reason": "end_turn",
            "content": [
                {"type": "thinking", "thinking": ""},
                {"type": "text", "text": "{\"translations\":[\"a\"]}"}
            ]
        }"#;
        assert_eq!(parse_response(body, 1).unwrap(), vec!["a".to_string()]);
    }

    #[test]
    fn a_wrong_count_is_an_error_rather_than_a_silent_desync() {
        // The failure this guards against is the worst one available: two
        // translations pinned to three timestamps shifts every later cue.
        let body = r#"{"stop_reason":"end_turn","content":[{"type":"text","text":"{\"translations\":[\"a\",\"b\"]}"}]}"#;
        assert_eq!(
            parse_response(body, 3),
            Err(TranslateError::CountMismatch { sent: 3, got: 2 })
        );
    }

    #[test]
    fn a_refusal_is_reported_as_a_refusal_not_as_empty_output() {
        let body = r#"{"stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber"},"content":[]}"#;
        assert_eq!(
            parse_response(body, 1),
            Err(TranslateError::Refused("cyber".into()))
        );
    }

    #[test]
    fn an_api_error_body_surfaces_its_own_message() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"credit balance is too low"}}"#;
        match parse_response(body, 1) {
            Err(TranslateError::Backend(m)) => assert!(m.contains("credit balance")),
            other => panic!("expected a backend error, got {other:?}"),
        }
    }

    #[test]
    fn malformed_bodies_are_reported_rather_than_panicking() {
        assert!(matches!(
            parse_response("not json", 1),
            Err(TranslateError::Parse(_))
        ));
        assert!(matches!(
            parse_response(r#"{"stop_reason":"end_turn","content":[]}"#, 1),
            Err(TranslateError::Parse(_))
        ));
        assert!(matches!(
            parse_response(
                r#"{"stop_reason":"end_turn","content":[{"type":"text","text":"{\"nope\":1}"}]}"#,
                1
            ),
            Err(TranslateError::Parse(_))
        ));
    }
}
