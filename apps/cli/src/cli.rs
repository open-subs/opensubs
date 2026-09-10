//! Hand-rolled argument parsing.
//!
//! Deliberately dependency-free (no `clap`): the workspace has no CLI
//! framework and disk is tight on the build host. Everything here is a pure
//! function of `&[String]` so the whole surface is unit-testable without
//! spawning ffmpeg or touching the filesystem.

use std::path::{Path, PathBuf};
use subs_media::{OutputSize, TrimRange};

pub const USAGE: &str = "\
opensubs burn <INPUT> [options]

  -o, --output <PATH>      output file (default: <input-stem>.subbed.mp4)
      --style <NAME>       preset name (see `opensubs styles`; default Clean)
      --style-file <PATH>  a style template JSON instead of a shipped preset
      --model <PATH>       whisper ggml model; enables real ASR
      --language <LANG>    ASR language (default auto)
      --mock <PATH>        use a fixture transcript JSON instead of ASR (testing)

  clip
      --start <SEC>        cut from here (default 0)
      --end <SEC>          cut to here
      --duration <SEC>     cut this many seconds from --start

  output
      --height <N>         fit the export to this height, keeping aspect
      --size <WxH>         export at exactly these dimensions
      --crf <N>            x264 CRF (default 16)
      --preset <NAME>      x264 preset (default slow)
      --fast               use hardware encoding instead of x264
      --tonemap            tonemap HDR sources to SDR

  subtitles
      --translate-to <LANG>  translate the subtitles (see `opensubs languages`)
      --srt <PATH>         also write a sidecar .srt
      --vtt <PATH>         also write a sidecar .vtt
      --source-srt <PATH>  with --translate-to, also write the spoken-language .srt

  misc
      --ffmpeg <PATH>      ffmpeg binary (default: search PATH)
      --keep-work          keep the intermediate work directory
  -q, --quiet              suppress the progress bar

opensubs styles [--export <NAME>]   list the presets, or print one as JSON
opensubs languages                  list the translation targets
opensubs features                   show what is free, premium, and unlocked
opensubs probe <INPUT>              print MediaInfo as JSON";

/// A misuse of the command line: bad flag, missing value, missing/duplicate
/// positional argument. Always exit code 2. `None` means "just show usage"
/// (bare `--help` or no arguments at all), `Some` carries an explanation to
/// print alongside the usage text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageError(pub Option<String>);

impl UsageError {
    fn msg(s: impl Into<String>) -> Self {
        UsageError(Some(s.into()))
    }

    fn help() -> Self {
        UsageError(None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AsrChoice {
    Model(PathBuf),
    Mock(PathBuf),
}

/// Where the look comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StyleSource {
    /// One of the shipped presets, by name.
    Preset(String),
    /// A user's own template JSON. Read by `main`, not here -- this module
    /// stays free of I/O so it can be unit-tested on argument lists alone.
    File(PathBuf),
}

#[derive(Debug, Clone, PartialEq)]
pub struct BurnArgs {
    pub input: PathBuf,
    pub output: PathBuf,
    pub style: StyleSource,
    pub asr: AsrChoice,
    pub language: Option<String>,
    pub translate_to: Option<String>,
    pub srt: Option<PathBuf>,
    pub vtt: Option<PathBuf>,
    pub source_srt: Option<PathBuf>,
    pub trim: TrimRange,
    pub size: OutputSize,
    pub crf: u8,
    pub preset: String,
    pub fast: bool,
    pub tonemap: bool,
    pub ffmpeg: Option<PathBuf>,
    pub keep_work: bool,
    pub quiet: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StylesArgs {
    /// Print this preset as a template JSON instead of listing.
    pub export: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeArgs {
    pub input: PathBuf,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Burn(Box<BurnArgs>),
    Styles(StylesArgs),
    Languages,
    Features,
    Probe(ProbeArgs),
    Version,
}

/// The default output path: `<input-stem>.subbed.mp4`, next to the input.
pub fn default_output(input: &Path) -> PathBuf {
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    input.with_file_name(format!("{stem}.subbed.mp4"))
}

/// Parse a `WxH` size, e.g. `1080x1920`.
fn parse_size(v: &str) -> Result<OutputSize, UsageError> {
    let (w, h) = v
        .split_once(['x', 'X'])
        .ok_or_else(|| UsageError::msg(format!("--size: '{v}' is not WxH, e.g. 1080x1920")))?;
    let parse = |s: &str, which: &str| {
        s.trim()
            .parse::<u32>()
            .ok()
            .filter(|n| *n >= 2)
            .ok_or_else(|| {
                UsageError::msg(format!("--size: {which} '{s}' is not a size in pixels"))
            })
    };
    Ok(OutputSize::Exact(parse(w, "width")?, parse(h, "height")?))
}

fn parse_seconds(name: &str, v: &str) -> Result<f64, UsageError> {
    v.trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .ok_or_else(|| UsageError::msg(format!("{name}: '{v}' is not a number of seconds")))
}

pub fn parse_args(args: &[String]) -> Result<Command, UsageError> {
    let Some((head, rest)) = args.split_first() else {
        return Err(UsageError::help());
    };
    match head.as_str() {
        "--help" | "-h" | "help" => Err(UsageError::help()),
        // Packaging scripts shell out to `--version` to confirm the binary in
        // a built artifact actually runs, so this must succeed with exit 0 and
        // print a single parseable line.
        "--version" | "-V" | "version" => {
            if !rest.is_empty() {
                return Err(UsageError::msg("'--version' takes no arguments"));
            }
            Ok(Command::Version)
        }
        "styles" => parse_styles(rest),
        "languages" => {
            if !rest.is_empty() {
                return Err(UsageError::msg("'languages' takes no arguments"));
            }
            Ok(Command::Languages)
        }
        "features" => {
            if !rest.is_empty() {
                return Err(UsageError::msg("'features' takes no arguments"));
            }
            Ok(Command::Features)
        }
        "probe" => parse_probe(rest),
        "burn" => parse_burn(rest).map(|b| Command::Burn(Box::new(b))),
        other => Err(UsageError::msg(format!("unknown command '{other}'"))),
    }
}

fn parse_styles(rest: &[String]) -> Result<Command, UsageError> {
    match rest {
        [] => Ok(Command::Styles(StylesArgs::default())),
        [flag, name] if flag == "--export" => Ok(Command::Styles(StylesArgs {
            export: Some(name.clone()),
        })),
        [flag] if flag == "--export" => Err(UsageError::msg("--export requires a preset name")),
        _ => Err(UsageError::msg(
            "'styles' takes no arguments, or '--export <NAME>'",
        )),
    }
}

fn parse_probe(rest: &[String]) -> Result<Command, UsageError> {
    match rest {
        [] => Err(UsageError::msg("'probe' requires an input file")),
        [input] => Ok(Command::Probe(ProbeArgs {
            input: PathBuf::from(input),
        })),
        _ => Err(UsageError::msg(format!(
            "'probe' takes exactly one argument, got {}",
            rest.len()
        ))),
    }
}

fn parse_burn(rest: &[String]) -> Result<BurnArgs, UsageError> {
    let mut input: Option<PathBuf> = None;
    let mut output: Option<PathBuf> = None;
    let mut style: Option<String> = None;
    let mut style_file: Option<PathBuf> = None;
    let mut model: Option<PathBuf> = None;
    let mut mock: Option<PathBuf> = None;
    let mut language: Option<String> = None;
    let mut translate_to: Option<String> = None;
    let mut srt: Option<PathBuf> = None;
    let mut vtt: Option<PathBuf> = None;
    let mut source_srt: Option<PathBuf> = None;
    let mut start: Option<f64> = None;
    let mut end: Option<f64> = None;
    let mut duration: Option<f64> = None;
    let mut height: Option<u32> = None;
    let mut size: Option<OutputSize> = None;
    let mut crf: Option<u8> = None;
    let mut preset: Option<String> = None;
    let mut fast = false;
    let mut tonemap = false;
    let mut ffmpeg: Option<PathBuf> = None;
    let mut keep_work = false;
    let mut quiet = false;

    let mut i = 0;
    while i < rest.len() {
        let tok = rest[i].as_str();

        // A value-taking flag consumes rest[i+1]; helper closure fetches it
        // or reports which flag was left dangling.
        let take_value = |name: &str| -> Result<String, UsageError> {
            let v = rest
                .get(i + 1)
                .ok_or_else(|| UsageError::msg(format!("{name} requires a value")))?;
            Ok(v.clone())
        };

        match tok {
            "--help" | "-h" => return Err(UsageError::help()),
            "-o" | "--output" => {
                output = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--style" => {
                style = Some(take_value(tok)?);
                i += 2;
            }
            "--style-file" => {
                style_file = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--model" => {
                model = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--language" => {
                language = Some(take_value(tok)?);
                i += 2;
            }
            "--mock" => {
                mock = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--translate-to" => {
                translate_to = Some(take_value(tok)?);
                i += 2;
            }
            "--start" => {
                start = Some(parse_seconds(tok, &take_value(tok)?)?);
                i += 2;
            }
            "--end" => {
                end = Some(parse_seconds(tok, &take_value(tok)?)?);
                i += 2;
            }
            "--duration" => {
                duration = Some(parse_seconds(tok, &take_value(tok)?)?);
                i += 2;
            }
            "--height" => {
                let v = take_value(tok)?;
                height = Some(
                    v.trim()
                        .parse::<u32>()
                        .ok()
                        .filter(|n| *n >= 2)
                        .ok_or_else(|| {
                            UsageError::msg(format!("--height: '{v}' is not a height in pixels"))
                        })?,
                );
                i += 2;
            }
            "--size" => {
                size = Some(parse_size(&take_value(tok)?)?);
                i += 2;
            }
            "--source-srt" => {
                source_srt = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--srt" => {
                srt = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--vtt" => {
                vtt = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--crf" => {
                let v = take_value(tok)?;
                crf = Some(
                    v.parse::<u8>()
                        .map_err(|_| UsageError::msg(format!("--crf: '{v}' is not 0-255")))?,
                );
                i += 2;
            }
            "--preset" => {
                preset = Some(take_value(tok)?);
                i += 2;
            }
            "--fast" => {
                fast = true;
                i += 1;
            }
            "--tonemap" => {
                tonemap = true;
                i += 1;
            }
            "--ffmpeg" => {
                ffmpeg = Some(PathBuf::from(take_value(tok)?));
                i += 2;
            }
            "--keep-work" => {
                keep_work = true;
                i += 1;
            }
            "-q" | "--quiet" => {
                quiet = true;
                i += 1;
            }
            _ if tok.starts_with('-') => {
                return Err(UsageError::msg(format!("unknown flag '{tok}'")));
            }
            _ => {
                if let Some(existing) = &input {
                    return Err(UsageError::msg(format!(
                        "unexpected extra argument '{tok}' (input is already '{}')",
                        existing.display()
                    )));
                }
                input = Some(PathBuf::from(tok));
                i += 1;
            }
        }
    }

    let input = input.ok_or_else(|| UsageError::msg("'burn' requires an input file"))?;

    let style = match (style, style_file) {
        (Some(_), Some(_)) => {
            return Err(UsageError::msg(
                "--style and --style-file are mutually exclusive",
            ))
        }
        (None, Some(path)) => StyleSource::File(path),
        (Some(name), None) => {
            // Validated against the real preset list rather than a copy of
            // it, so adding a preset never needs a second edit here.
            if subs_style::preset_by_name(&name).is_none() {
                let names: Vec<String> = subs_style::all_presets()
                    .into_iter()
                    .map(|p| p.name)
                    .collect();
                return Err(UsageError::msg(format!(
                    "--style '{name}' is not one of {}",
                    names.join("|")
                )));
            }
            StyleSource::Preset(name)
        }
        (None, None) => StyleSource::Preset("Clean".to_string()),
    };

    let trim = match (start, end, duration) {
        (_, Some(_), Some(_)) => {
            return Err(UsageError::msg(
                "--end and --duration are mutually exclusive; pick one",
            ))
        }
        (s, None, Some(d)) => {
            if d <= 0.0 {
                return Err(UsageError::msg("--duration must be greater than zero"));
            }
            TrimRange::from_duration(s.unwrap_or(0.0), d)
        }
        (s, e, None) => TrimRange::new(s.unwrap_or(0.0), e),
    };
    // Source duration is unknown until the file is probed, so only the
    // internally-checkable half is enforced here; `main` re-validates
    // against the real duration once it has one.
    if let Err(e) = trim.validate(0.0) {
        return Err(UsageError::msg(e.to_string()));
    }

    let size = match (height, size) {
        (Some(_), Some(_)) => {
            return Err(UsageError::msg(
                "--height and --size are mutually exclusive; pick one",
            ))
        }
        (Some(h), None) => OutputSize::Height(h),
        (None, Some(s)) => s,
        (None, None) => OutputSize::Source,
    };

    if source_srt.is_some() && translate_to.is_none() {
        return Err(UsageError::msg(
            "--source-srt only means something with --translate-to; without it, use --srt",
        ));
    }

    let asr = match (model, mock) {
        (Some(_), Some(_)) => {
            return Err(UsageError::msg("--model and --mock are mutually exclusive"))
        }
        (Some(m), None) => AsrChoice::Model(m),
        (None, Some(m)) => AsrChoice::Mock(m),
        (None, None) => {
            return Err(UsageError::msg(
                "one of --model <PATH> (real ASR) or --mock <PATH> (fixture transcript, for \
                 testing) is required",
            ))
        }
    };

    let output = output.unwrap_or_else(|| default_output(&input));

    Ok(BurnArgs {
        input,
        output,
        style,
        asr,
        language,
        translate_to,
        srt,
        vtt,
        source_srt,
        trim,
        size,
        crf: crf.unwrap_or(16),
        preset: preset.unwrap_or_else(|| "slow".to_string()),
        fast,
        tonemap,
        ffmpeg,
        keep_work,
        quiet,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn burn(args: &[&str]) -> Result<BurnArgs, UsageError> {
        let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        parse_burn(&owned)
    }

    #[test]
    fn no_arguments_is_a_bare_help_usage_error() {
        assert_eq!(parse_args(&[]).unwrap_err(), UsageError::help());
    }

    #[test]
    fn help_flag_is_a_bare_help_usage_error() {
        let args = vec!["--help".to_string()];
        assert_eq!(parse_args(&args).unwrap_err(), UsageError::help());
    }

    #[test]
    fn unknown_command_is_a_usage_error() {
        let args = vec!["frobnicate".to_string()];
        let err = parse_args(&args).unwrap_err();
        assert!(err.0.unwrap().contains("unknown command"));
    }

    #[test]
    fn styles_command_parses() {
        let args = vec!["styles".to_string()];
        assert_eq!(
            parse_args(&args).unwrap(),
            Command::Styles(StylesArgs::default())
        );
    }

    #[test]
    fn probe_command_parses_its_one_positional() {
        let args = vec!["probe".to_string(), "in.mp4".to_string()];
        assert_eq!(
            parse_args(&args).unwrap(),
            Command::Probe(ProbeArgs {
                input: PathBuf::from("in.mp4")
            })
        );
    }

    #[test]
    fn probe_without_a_file_is_a_usage_error() {
        let args = vec!["probe".to_string()];
        assert!(parse_args(&args).is_err());
    }

    #[test]
    fn burn_defaults_are_sane() {
        let b = burn(&["in.mp4", "--mock", "fixture.json"]).unwrap();
        assert_eq!(b.input, PathBuf::from("in.mp4"));
        assert_eq!(b.output, PathBuf::from("in.subbed.mp4"));
        assert_eq!(b.style, StyleSource::Preset("Clean".into()));
        assert_eq!(b.asr, AsrChoice::Mock(PathBuf::from("fixture.json")));
        assert_eq!(b.language, None);
        assert_eq!(b.srt, None);
        assert_eq!(b.vtt, None);
        assert_eq!(b.crf, 16);
        assert_eq!(b.preset, "slow");
        assert!(!b.fast);
        assert!(!b.tonemap);
        assert_eq!(b.ffmpeg, None);
        assert!(!b.keep_work);
        assert!(!b.quiet);
    }

    #[test]
    fn output_path_is_derived_from_the_input_stem() {
        assert_eq!(
            default_output(Path::new("clip.mp4")),
            PathBuf::from("clip.subbed.mp4")
        );
        assert_eq!(
            default_output(Path::new("/videos/clip.mov")),
            PathBuf::from("/videos/clip.subbed.mp4")
        );
        // No extension at all must not panic.
        assert_eq!(
            default_output(Path::new("noext")),
            PathBuf::from("noext.subbed.mp4")
        );
    }

    #[test]
    fn every_flag_is_parsed() {
        let b = burn(&[
            "in.mp4",
            "-o",
            "out.mp4",
            "--style",
            "Bold",
            "--model",
            "model.bin",
            "--language",
            "fr",
            "--srt",
            "out.srt",
            "--vtt",
            "out.vtt",
            "--crf",
            "20",
            "--preset",
            "fast",
            "--fast",
            "--tonemap",
            "--ffmpeg",
            "/opt/bin/ffmpeg",
            "--keep-work",
            "-q",
        ])
        .unwrap();
        assert_eq!(b.output, PathBuf::from("out.mp4"));
        assert_eq!(b.style, StyleSource::Preset("Bold".into()));
        assert_eq!(b.asr, AsrChoice::Model(PathBuf::from("model.bin")));
        assert_eq!(b.language.as_deref(), Some("fr"));
        assert_eq!(b.srt, Some(PathBuf::from("out.srt")));
        assert_eq!(b.vtt, Some(PathBuf::from("out.vtt")));
        assert_eq!(b.crf, 20);
        assert_eq!(b.preset, "fast");
        assert!(b.fast);
        assert!(b.tonemap);
        assert_eq!(b.ffmpeg, Some(PathBuf::from("/opt/bin/ffmpeg")));
        assert!(b.keep_work);
        assert!(b.quiet);
    }

    #[test]
    fn long_output_alias_also_works() {
        let b = burn(&["in.mp4", "--mock", "f.json", "--output", "out2.mp4"]).unwrap();
        assert_eq!(b.output, PathBuf::from("out2.mp4"));
    }

    #[test]
    fn quiet_long_form_also_works() {
        let b = burn(&["in.mp4", "--mock", "f.json", "--quiet"]).unwrap();
        assert!(b.quiet);
    }

    #[test]
    fn unknown_flag_is_a_usage_error() {
        let err = burn(&["in.mp4", "--mock", "f.json", "--bogus"]).unwrap_err();
        assert!(err.0.unwrap().contains("--bogus"));
    }

    #[test]
    fn missing_value_is_a_usage_error() {
        let err = burn(&["in.mp4", "--mock", "f.json", "--style"]).unwrap_err();
        assert!(err.0.unwrap().contains("--style"));
    }

    #[test]
    fn missing_value_at_end_of_args_for_output_is_a_usage_error() {
        let err = burn(&["in.mp4", "-o"]).unwrap_err();
        assert!(err.0.unwrap().contains("-o"));
    }

    #[test]
    fn model_and_mock_together_is_a_usage_error() {
        let err = burn(&["in.mp4", "--model", "m.bin", "--mock", "f.json"]).unwrap_err();
        assert!(err.0.unwrap().contains("mutually exclusive"));
    }

    #[test]
    fn neither_model_nor_mock_is_a_usage_error() {
        let err = burn(&["in.mp4"]).unwrap_err();
        let msg = err.0.unwrap();
        assert!(msg.contains("--model"));
        assert!(msg.contains("--mock"));
    }

    #[test]
    fn missing_input_is_a_usage_error() {
        let err = burn(&["--mock", "f.json"]).unwrap_err();
        assert!(err.0.unwrap().contains("input file"));
    }

    #[test]
    fn two_positionals_is_a_usage_error() {
        let err = burn(&["in.mp4", "extra.mp4", "--mock", "f.json"]).unwrap_err();
        assert!(err.0.unwrap().contains("extra"));
    }

    #[test]
    fn unknown_style_name_is_a_usage_error() {
        let err = burn(&["in.mp4", "--mock", "f.json", "--style", "Nope"]).unwrap_err();
        assert!(err.0.unwrap().contains("--style"));
    }

    #[test]
    fn bad_crf_value_is_a_usage_error() {
        let err = burn(&["in.mp4", "--mock", "f.json", "--crf", "not-a-number"]).unwrap_err();
        assert!(err.0.unwrap().contains("--crf"));
    }

    #[test]
    fn crf_out_of_u8_range_is_a_usage_error() {
        let err = burn(&["in.mp4", "--mock", "f.json", "--crf", "999"]).unwrap_err();
        assert!(err.0.unwrap().contains("--crf"));
    }

    #[test]
    fn a_clip_is_expressed_as_a_start_and_an_end() {
        let b = burn(&[
            "in.mp4", "--mock", "f.json", "--start", "12.5", "--end", "20",
        ])
        .unwrap();
        assert_eq!(b.trim, TrimRange::new(12.5, Some(20.0)));
    }

    #[test]
    fn a_duration_is_the_same_clip_as_the_equivalent_end() {
        let by_duration = burn(&[
            "in.mp4",
            "--mock",
            "f.json",
            "--start",
            "2",
            "--duration",
            "5",
        ])
        .unwrap();
        let by_end = burn(&["in.mp4", "--mock", "f.json", "--start", "2", "--end", "7"]).unwrap();
        assert_eq!(by_duration.trim, by_end.trim);
    }

    #[test]
    fn no_clip_flags_means_the_whole_video() {
        assert!(burn(&["in.mp4", "--mock", "f.json"])
            .unwrap()
            .trim
            .is_full());
    }

    #[test]
    fn contradictory_or_impossible_clips_are_refused() {
        assert!(burn(&[
            "in.mp4",
            "--mock",
            "f.json",
            "--end",
            "5",
            "--duration",
            "5"
        ])
        .is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--start", "9", "--end", "4"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--start", "-1"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--duration", "0"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--start", "abc"]).is_err());
    }

    #[test]
    fn export_size_comes_from_a_height_or_exact_dimensions() {
        assert_eq!(
            burn(&["in.mp4", "--mock", "f.json", "--height", "720"])
                .unwrap()
                .size,
            OutputSize::Height(720)
        );
        assert_eq!(
            burn(&["in.mp4", "--mock", "f.json", "--size", "1080x1920"])
                .unwrap()
                .size,
            OutputSize::Exact(1080, 1920)
        );
        assert_eq!(
            burn(&["in.mp4", "--mock", "f.json"]).unwrap().size,
            OutputSize::Source
        );
    }

    #[test]
    fn a_malformed_or_contradictory_size_is_refused() {
        assert!(burn(&["in.mp4", "--mock", "f.json", "--size", "1080"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--size", "0x100"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--size", "axb"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--height", "0"]).is_err());
        assert!(burn(&["in.mp4", "--mock", "f.json", "--height", "720", "--size", "1x1"]).is_err());
    }

    #[test]
    fn a_translation_target_is_carried_through_verbatim() {
        let b = burn(&["in.mp4", "--mock", "f.json", "--translate-to", "zh-Hans"]).unwrap();
        assert_eq!(b.translate_to.as_deref(), Some("zh-Hans"));
        assert_eq!(
            burn(&["in.mp4", "--mock", "f.json"]).unwrap().translate_to,
            None
        );
    }

    #[test]
    fn a_source_sidecar_without_a_translation_is_a_usage_error() {
        // It would just duplicate --srt, which means the user meant
        // something else and should be told.
        assert!(burn(&["in.mp4", "--mock", "f.json", "--source-srt", "a.srt"]).is_err());
        assert!(burn(&[
            "in.mp4",
            "--mock",
            "f.json",
            "--translate-to",
            "ja",
            "--source-srt",
            "a.srt"
        ])
        .is_ok());
    }

    #[test]
    fn a_style_file_replaces_the_preset_and_cannot_be_combined_with_one() {
        let b = burn(&["in.mp4", "--mock", "f.json", "--style-file", "look.json"]).unwrap();
        assert_eq!(b.style, StyleSource::File(PathBuf::from("look.json")));
        assert!(burn(&[
            "in.mp4",
            "--mock",
            "f.json",
            "--style",
            "Clean",
            "--style-file",
            "look.json"
        ])
        .is_err());
    }

    #[test]
    fn advanced_presets_are_selectable_by_name() {
        assert_eq!(
            burn(&["in.mp4", "--mock", "f.json", "--style", "Neon"])
                .unwrap()
                .style,
            StyleSource::Preset("Neon".into())
        );
    }

    #[test]
    fn styles_export_and_the_other_listing_commands_parse() {
        let args: Vec<String> = ["styles", "--export", "Clean"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            parse_args(&args).unwrap(),
            Command::Styles(StylesArgs {
                export: Some("Clean".into())
            })
        );
        assert_eq!(
            parse_args(&["languages".to_string()]).unwrap(),
            Command::Languages
        );
        assert_eq!(
            parse_args(&["features".to_string()]).unwrap(),
            Command::Features
        );
        assert!(parse_args(&["styles".to_string(), "--export".to_string()]).is_err());
        assert!(parse_args(&["features".to_string(), "x".to_string()]).is_err());
    }
}
