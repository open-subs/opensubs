//! Print every stage of a transcription for one 16 kHz mono WAV: where the
//! voice detector heard speech, what Whisper wrote and when, and the words
//! that came out the other end. Point it at real recordings when changing
//! any of those stages; synthetic clips do not exercise them.
//!
//!   cargo run --release -p subs-whisper --example trace -- <model.bin> <audio.wav> [language]

use subs_asr::{AsrOptions, AudioRef, Transcriber};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(model), Some(wav)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: trace <model.bin> <audio.wav> [language]");
        std::process::exit(2);
    };
    let mut reader = hound::WavReader::open(wav).expect("a 16 kHz mono WAV");
    let samples: Vec<f32> = reader.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
    let spans = subs_whisper::vad::speech_spans(&samples).expect("voice detector");
    println!("speech ({:.1}s of {:.1}s):", subs_asr::speech_seconds(&spans), samples.len() as f64 / 16_000.0);
    for s in &spans {
        println!("  {:7.2} - {:7.2}", s.start, s.end);
    }
    let mut t = subs_whisper::WhisperTranscriber::new(model);
    if let Some(lang) = args.get(3) {
        t = t.with_language(lang.clone());
    }
    let out = t.transcribe(&AudioRef::new(wav), &AsrOptions::default()).expect("transcribe");
    println!("language {}; {} segments:", out.language, out.segments.len());
    for s in &out.segments {
        println!("  {:7.2} - {:7.2}  {}", s.start, s.end, s.text);
    }
    if let Some(w) = out.words.first() {
        println!("first word {:.2}-{:.2} {:?}", w.start, w.end, w.text);
    }
}
