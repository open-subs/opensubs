//! Job orchestration: probe -> transcribe -> segment -> style -> burn.

mod ffmpeg_install;
pub mod job;
mod paths;
pub mod progress;

pub use ffmpeg_install::{brew_binary, install_ffmpeg_full};
pub use job::{ffmpeg_binary, plan_job, write_ass, JobError, JobSpec, PlannedJob};
pub use progress::{NullSink, ProgressEvent, ProgressParser, ProgressSink};
