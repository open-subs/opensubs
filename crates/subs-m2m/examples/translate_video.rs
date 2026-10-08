//! The desktop export's path from audio to translated subtitles, from the
//! command line: transcribe, segment, `translate_cues` -- the same three steps
//! `subs_pipeline::plan_job` takes -- then a count of what came out.
//!
//! cargo run -p subs-m2m --example translate_video --release -- \
//!     <whisper model.bin> <16k-mono.wav> <m2m100 dir> <target> [fps] [--json out.jsonl]
//!
//! Each translated cue is classed for a Chinese target: whether it still
//! holds English words, and whether it holds characters of the other script
//! (Traditional in a Simplified target, or the reverse).
use std::io::Write;
use std::path::Path;

use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use subs_asr::{AsrOptions, AudioRef, Transcriber};
use subs_media::Rational;
use subs_subtitle::segment::{segment, SegmentConfig};
use subs_translate::{translate_cues, TranslateRequest};

fn english_words(s: &str) -> usize {
    s.split(|c: char| !c.is_ascii_alphabetic() && c != '\'')
        .filter(|w| w.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 2)
        .count()
}

/// Characters that a script conversion would change: in a Simplified target,
/// the Traditional ones.
fn other_script(s: &str, to_target: &OpenCC) -> Vec<char> {
    s.chars()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
        .filter(|c| {
            let one = c.to_string();
            to_target.convert(&one) != one
        })
        .collect()
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (model, wav, m2m_dir, target) = (&a[1], &a[2], &a[3], &a[4]);
    let fps: u32 = a.get(5).and_then(|s| s.parse().ok()).unwrap_or(30);
    let json = a.iter().position(|x| x == "--json").and_then(|i| a.get(i + 1));

    let transcript = subs_whisper::WhisperTranscriber::new(model)
        .transcribe(&AudioRef::new(wav), &AsrOptions::default())
        .expect("transcribe");
    let cues = segment(&transcript, Rational { num: fps, den: 1 }, &SegmentConfig::default());

    let translator = subs_m2m::M2mTranslator::new(Path::new(m2m_dir)).expect("load m2m");
    let req = TranslateRequest::to(target.as_str()).from_language(transcript.language.clone());
    let started = std::time::Instant::now();
    let out = translate_cues(&cues, &translator, &req).expect("translate");
    eprintln!("{} cues, language {}, translated in {:.1}s", cues.len(), transcript.language, started.elapsed().as_secs_f64());

    let to_target = OpenCC::from_config(if target.ends_with("Hant") || target.ends_with("TW") || target.ends_with("HK") {
        BuiltinConfig::S2t
    } else {
        BuiltinConfig::T2s
    })
    .expect("opencc");

    let mut sink = json.map(|p| std::fs::File::create(p).expect("json out"));
    let (mut clean, mut with_english, mut with_other) = (0, 0, 0);
    for (src, dst) in cues.iter().zip(&out) {
        let text = dst.text().replace('\n', " ");
        let en = english_words(&text);
        let other = other_script(&text, &to_target);
        if en > 0 {
            with_english += 1;
        }
        if !other.is_empty() {
            with_other += 1;
        }
        if en == 0 && other.is_empty() {
            clean += 1;
        }
        println!(
            "{:6.2}-{:6.2}  {}\n               -> {}  [en:{} other:{}]",
            src.start,
            src.end,
            src.text().replace('\n', " "),
            text,
            en,
            other.iter().collect::<String>()
        );
        if let Some(f) = sink.as_mut() {
            let line = format!(
                "{{\"start\":{:.2},\"end\":{:.2},\"source\":{:?},\"translated\":{:?},\"english_words\":{},\"other_script\":{:?}}}\n",
                src.start,
                src.end,
                src.text().replace('\n', " "),
                text,
                en,
                other.iter().collect::<String>()
            );
            f.write_all(line.as_bytes()).unwrap();
        }
    }
    println!(
        "\n{} cues: {} clean, {} with English words, {} with characters of the other script",
        out.len(),
        clean,
        with_english,
        with_other
    );
}
