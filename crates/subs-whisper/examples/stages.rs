//! How long each stage of a transcription takes on this computer's processor,
//! for one 16 kHz mono WAV and a base-family model:
//!
//!   cargo run --release -p subs-whisper --example stages -- <model.bin> <audio.wav>
//!
//! The voice detector, loading the model, and Whisper itself with and
//! without the word alignment (DTW) the app asks for, each twice.
use std::time::Instant;
use whisper_rs::{DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut reader = hound::WavReader::open(&a[2]).expect("a 16 kHz mono WAV");
    let samples: Vec<f32> = reader.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32;
    eprintln!("stage threads: {threads}");

    let t = Instant::now();
    let spans = subs_whisper::vad::speech_spans(&samples).expect("voice detector");
    eprintln!("stage vad: {:.2}s ({} spans)", t.elapsed().as_secs_f64(), spans.len());

    for dtw in [true, false] {
        let mut p = WhisperContextParameters::default();
        p.use_gpu(false);
        if dtw {
            p.dtw_parameters(DtwParameters { mode: DtwMode::ModelPreset { model_preset: DtwModelPreset::Base }, ..DtwParameters::default() });
        }
        let t = Instant::now();
        let ctx = WhisperContext::new_with_params(&a[1], p).expect("model");
        eprintln!("stage load (dtw {dtw}): {:.2}s", t.elapsed().as_secs_f64());
        for run in 1..=2 {
            let mut state = ctx.create_state().expect("state");
            let mut fp = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            fp.set_language(Some("en"));
            fp.set_print_progress(false);
            fp.set_print_realtime(false);
            fp.set_print_timestamps(false);
            fp.set_suppress_nst(true);
            fp.set_n_threads(threads);
            let t = Instant::now();
            state.full(fp, &samples).expect("full");
            eprintln!("stage full (dtw {dtw}) run {run}: {:.2}s", t.elapsed().as_secs_f64());
        }
    }
}
