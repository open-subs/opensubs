//! Print the graphics chips whisper.cpp can see on this computer and which
//! device a transcription would use. For a report from a machine we do not
//! have: run it and send back what it prints.
//!
//!   cargo run --release -p subs-whisper --example chips

fn main() {
    let chips = subs_whisper::device::chips();
    if chips.is_empty() {
        println!("no graphics chip whisper.cpp can use");
    }
    for c in &chips {
        println!("{}: {} ({}, {})", c.index, c.name, c.backend, if c.integrated { "integrated" } else { "not integrated" });
    }
    match subs_whisper::device::DEVICE.chip() {
        Some(i) => println!("transcription uses graphics chip {i}"),
        None => println!("transcription uses the processor"),
    }
}
