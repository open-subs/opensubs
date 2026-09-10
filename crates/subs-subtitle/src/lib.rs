//! Transcript -> cue segmentation and subtitle serialisation.
//!
//! **This crate performs no I/O.** Every function is pure, which is what
//! lets the segmentation invariants be property-tested exhaustively.

pub mod cue;
pub mod linebreak;
pub mod parse;
pub mod segment;
pub mod serialize;
pub mod snap;
pub mod width;

pub use cue::{fmt_ass, fmt_srt, fmt_vtt, Cue};
pub use linebreak::{wrap_lines, MAX_LINES};
pub use parse::{parse_subtitles, ParseError};
pub use segment::{segment, SegmentConfig};
pub use serialize::{to_srt, to_vtt};
pub use snap::{enforce_gaps, snap_to_frame, MIN_GAP_FRAMES};
pub use width::{
    is_cjk_char, is_cjk_dominant, join_tokens, joined_len, line_budget, needs_space_between,
    MAX_CHARS_CJK, MAX_CHARS_LATIN,
};
