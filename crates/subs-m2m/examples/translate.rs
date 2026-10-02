//! cargo run -p subs-m2m --example translate --release -- <model-dir> <from> <to> "text" ["text" ...]
use subs_translate::{TranslateRequest, Translator};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let t = subs_m2m::M2mTranslator::new(std::path::Path::new(&a[1])).expect("load");
    let req = TranslateRequest { target: a[3].clone(), source: Some(a[2].clone()) };
    let started = std::time::Instant::now();
    for line in t.translate(&a[4..].to_vec(), &req).expect("translate") {
        println!("{line}");
    }
    eprintln!("{:.2}s", started.elapsed().as_secs_f64());
}
