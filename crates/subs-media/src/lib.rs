//! Media probing and ffmpeg argument-vector construction.
//!
//! Argv builders are pure functions returning `Vec<String>`. Nothing in this
//! crate spawns a process except the explicitly-named `*_spawn` helpers, so
//! the vast majority of tests need no ffmpeg installed.

pub mod audio;
pub mod burn;
pub mod color;
pub mod info;
pub mod probe;
pub mod rational;
pub mod scale;
pub mod trim;

pub use audio::extract_audio_args;
pub use burn::{burn_args, BurnJob, VideoEncoder};
pub use color::{ColorMeta, HdrKind};
pub use info::{MediaError, MediaInfo};
pub use probe::probe_args;
pub use rational::Rational;
pub use scale::{scale_filter, OutputSize};
pub use trim::{TrimError, TrimRange};
