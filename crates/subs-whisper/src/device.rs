//! Which device Whisper runs on: a graphics chip or the processor.
//!
//! Nobody using the app picks this, so it is decided here, and the processor
//! -- what every computer could already do -- is the answer wherever a
//! graphics chip is not known to be better:
//!
//! - A Mac (Apple Silicon is all we build for) uses its graphics chip through
//!   Metal: 1.4x to 2.9x faster for the same words, more on the larger models.
//! - Windows and Linux use one only in a build made with the `vulkan`
//!   feature, and then only a separate graphics card. Integrated graphics
//!   share the processor's memory and can as easily lose to it as win, and
//!   their drivers are where Vulkan goes wrong.
//! - A build with no graphics backend has only the processor.
//!
//! A graphics chip is trusted once it has finished a transcription. Until
//! then a failure on it is tried again on the processor, and if the processor
//! manages, the processor does the work for the rest of the run: a driver
//! that cannot hold the model should cost one slower transcription, not the
//! transcript. If the processor fails as well, the graphics chip was not the
//! problem and stays the choice.
//!
//! `OPENSUBS_GPU=off` keeps everything on the processor, for the computer
//! this gets wrong.

use std::ffi::CStr;
use std::sync::atomic::{AtomicBool, Ordering};
use subs_asr::AsrError;
use whisper_rs::whisper_rs_sys as sys;

/// A graphics chip whisper.cpp can run on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chip {
    /// Its number as whisper.cpp counts them (`gpu_device`).
    pub index: i32,
    /// "Metal", "Vulkan0", ...
    pub backend: String,
    /// What the driver calls it: "Apple M2", "NVIDIA GeForce RTX 3060", ...
    pub name: String,
    /// Part of the processor, sharing its memory, rather than a card.
    pub integrated: bool,
}

/// The graphics chips this build of whisper.cpp can see, in the order it
/// numbers them. Empty when the build has no graphics backend, when the
/// computer has no graphics driver, and in a virtual machine.
pub fn chips() -> Vec<Chip> {
    let mut found = Vec::new();
    // SAFETY: the registry is a process-wide table ggml fills on first use;
    // these calls read it and the strings it owns for the life of the process.
    unsafe {
        for i in 0..sys::ggml_backend_dev_count() {
            let dev = sys::ggml_backend_dev_get(i);
            if dev.is_null() {
                continue;
            }
            let kind = sys::ggml_backend_dev_type(dev);
            let integrated = kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU;
            if !integrated && kind != sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU {
                continue;
            }
            let text = |p: *const std::os::raw::c_char| {
                if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
            };
            found.push(Chip {
                // whisper.cpp counts graphics chips of either kind, in this order.
                index: found.len() as i32,
                backend: text(sys::ggml_backend_dev_name(dev)),
                name: text(sys::ggml_backend_dev_description(dev)),
                integrated,
            });
        }
    }
    found
}

/// The chip to use among `chips`, if any: a Mac's own, and elsewhere the
/// first separate card.
fn pick(chips: &[Chip], mac: bool) -> Option<i32> {
    chips.iter().find(|c| mac || !c.integrated).map(|c| c.index)
}

/// `OPENSUBS_GPU` set to a word for "no".
fn switched_off(value: Option<&str>) -> bool {
    matches!(value.map(str::trim).map(str::to_ascii_lowercase).as_deref(), Some("off" | "0" | "false" | "no"))
}

/// The choice for this run of the program.
pub struct Device {
    /// The graphics chip failed where the processor did not.
    off: AtomicBool,
    /// A transcription has finished on the graphics chip.
    proven: AtomicBool,
}

pub static DEVICE: Device = Device::new();

impl Device {
    pub const fn new() -> Self {
        Self { off: AtomicBool::new(false), proven: AtomicBool::new(false) }
    }

    /// The graphics chip the next transcription should use, as whisper.cpp
    /// numbers it, or `None` for the processor.
    pub fn chip(&self) -> Option<i32> {
        if switched_off(std::env::var("OPENSUBS_GPU").ok().as_deref()) || self.off.load(Ordering::Relaxed) {
            return None;
        }
        pick(&chips(), cfg!(target_os = "macos"))
    }

    /// Run `work(chip)` on the device this computer should use.
    pub fn run<T>(&self, work: impl Fn(Option<i32>) -> Result<T, AsrError>) -> Result<T, AsrError> {
        self.run_on(self.chip(), work)
    }

    fn run_on<T>(&self, chip: Option<i32>, work: impl Fn(Option<i32>) -> Result<T, AsrError>) -> Result<T, AsrError> {
        if chip.is_none() {
            return work(None);
        }
        let failed = match work(chip) {
            Ok(out) => {
                self.proven.store(true, Ordering::Relaxed);
                return Ok(out);
            }
            Err(e) => e,
        };
        if self.proven.load(Ordering::Relaxed) {
            return Err(failed);
        }
        match work(None) {
            Ok(out) => {
                if !self.off.swap(true, Ordering::Relaxed) {
                    eprintln!("opensubs: transcription failed on the graphics chip ({failed}); using the processor instead");
                }
                Ok(out)
            }
            // Not the graphics chip's doing: what it said is the error.
            Err(_) => Err(failed),
        }
    }
}

impl Default for Device {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn broken(what: &str) -> AsrError {
        AsrError::Backend(what.into())
    }

    fn chip(index: i32, name: &str, integrated: bool) -> Chip {
        Chip { index, backend: format!("Vulkan{index}"), name: name.into(), integrated }
    }

    #[test]
    fn a_mac_uses_its_chip_and_a_pc_only_a_separate_card() {
        let apple = [Chip { index: 0, backend: "Metal".into(), name: "Apple M2".into(), integrated: true }];
        assert_eq!(pick(&apple, true), Some(0));
        // A laptop with both: the card, whichever comes first.
        let both = [chip(0, "Intel(R) UHD Graphics", true), chip(1, "NVIDIA GeForce RTX 3060", false)];
        assert_eq!(pick(&both, false), Some(1));
        // Integrated graphics alone, a virtual machine, a build without a backend.
        assert_eq!(pick(&[chip(0, "Intel(R) Iris(R) Xe Graphics", true)], false), None);
        assert_eq!(pick(&[], false), None);
        assert_eq!(pick(&[], true), None);
    }

    #[test]
    fn the_switch_reads_a_word_for_no() {
        assert!(switched_off(Some("off")));
        assert!(switched_off(Some(" OFF ")));
        assert!(switched_off(Some("0")));
        assert!(!switched_off(Some("on")));
        assert!(!switched_off(None));
    }

    #[test]
    fn a_graphics_chip_that_fails_first_time_hands_over_to_the_processor() {
        let d = Device::new();
        let tried = RefCell::new(Vec::new());
        let out = d.run_on(Some(0), |chip| {
            tried.borrow_mut().push(chip);
            if chip.is_some() { Err(broken("no memory on the device")) } else { Ok("words") }
        });
        assert_eq!(out.unwrap(), "words");
        assert_eq!(*tried.borrow(), [Some(0), None]);
        // And stays there: the next transcription does not try it again.
        assert!(d.off.load(Ordering::Relaxed));
    }

    #[test]
    fn a_failure_the_processor_shares_is_not_blamed_on_the_graphics_chip() {
        let d = Device::new();
        let out: Result<(), _> = d.run_on(Some(0), |chip| Err(broken(if chip.is_some() { "bad audio (gpu)" } else { "bad audio (cpu)" })));
        assert!(format!("{}", out.unwrap_err()).contains("bad audio (gpu)"));
        assert!(!d.off.load(Ordering::Relaxed));
    }

    #[test]
    fn once_it_has_worked_its_failures_are_its_own() {
        let d = Device::new();
        assert!(d.run_on(Some(0), |_| Ok(())).is_ok());
        let tried = RefCell::new(Vec::new());
        let out: Result<(), _> = d.run_on(Some(0), |chip| {
            tried.borrow_mut().push(chip);
            Err(broken("later"))
        });
        assert!(out.is_err());
        assert_eq!(*tried.borrow(), [Some(0)]);
        assert!(!d.off.load(Ordering::Relaxed));
    }

    #[test]
    fn the_processor_alone_is_asked_once() {
        let d = Device::new();
        let tried = RefCell::new(0);
        let out: Result<(), _> = d.run_on(None, |_| {
            *tried.borrow_mut() += 1;
            Err(broken("bad audio"))
        });
        assert!(out.is_err());
        assert_eq!(*tried.borrow(), 1);
    }
}
