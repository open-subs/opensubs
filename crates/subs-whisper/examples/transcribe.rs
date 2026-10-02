//! cargo run -p subs-whisper --example transcribe --release -- <model.bin> <16k-mono.wav> [language]
use subs_asr::{AsrOptions, AudioRef, Transcriber};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let t = subs_whisper::WhisperTranscriber::new(&a[1]);
    let started = std::time::Instant::now();
    let out = t
        .transcribe(&AudioRef::new(&a[2]), &AsrOptions { language: a.get(3).cloned() })
        .expect("transcribe");
    eprintln!("{:.1}s, language {}", started.elapsed().as_secs_f64(), out.language);
    for s in &out.segments {
        println!("{:7.2} {:7.2}  {}", s.start, s.end, s.text);
    }
}
