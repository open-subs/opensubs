use crate::{Rgba, StyleTemplate};
use std::fmt::Write as _;
use subs_subtitle::{fmt_ass, join_tokens, Cue};

/// U+2060 WORD JOINER: invisible, zero-width, carries no joining or
/// line-breaking semantics. Used to separate a literal backslash from a
/// following character so libass cannot read the pair as an escape.
const WORD_JOINER: char = '\u{2060}';

/// Escape one line of cue text for an ASS `Dialogue` event.
///
/// libass reads three things specially in event text, and each one silently
/// corrupts or *deletes* subtitle content when it arrives unescaped:
///
/// - `{` opens an override block and `}` closes it. Everything between is
///   parsed as style commands and drawn as nothing, so a brace-enclosed word
///   simply vanishes from the burned video with no error anywhere. Measured
///   on a black clip: `"Hello world again"` renders at mean luma 17.04,
///   `"Hello {world} again"` at 16.70 against a 16.00 black floor -- the
///   word is genuinely gone. `\{` and `\}` are the literal forms.
/// - `\` begins an escape. `\N` and `\n` are line breaks and `\h` is a hard
///   space, so a stray backslash in the transcript can inject a line break
///   or eat the next character.
///
/// Note that `\\` is **not** a backslash escape in libass -- verified by
/// rendering. `\` followed by an unrecognised character emits a literal
/// backslash and then reparses from that character, so `a \\N b` still comes
/// out as two lines. The reliable encoding is a backslash followed by an
/// invisible [`WORD_JOINER`], which is never a recognised escape, so the
/// backslash renders literally and the next character is left alone.
fn escape_dialogue_text(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    for c in line.chars() {
        match c {
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '\\' => {
                out.push('\\');
                out.push(WORD_JOINER);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Make a string safe to place in a comma-delimited `Style:` field.
///
/// The `Style:` line is split positionally on commas and ASS defines no
/// escape for one, so a single comma inside e.g. a font name shifts every
/// subsequent field by one -- `Fontsize` is read from the colour column,
/// alignment from the margins -- and silently corrupts the entire style
/// rather than just that field. Dropping the comma keeps the line's shape,
/// which is the only recoverable outcome available.
fn sanitize_style_field(value: &str) -> String {
    value.replace(',', "")
}

/// Wrap each token in an `{\fs}` override sized by its own loudness.
///
/// Returns `None` when the level count does not match the token count, so
/// the caller falls back to unemphasised text rather than shifting every
/// level one word along.
///
/// Tokens are split on whitespace, which is also how the levels were
/// counted; `\N` line breaks sit inside their own token and are stepped
/// over so a break never lands inside an override block.
/// One renderable piece of a cue's escaped text.
///
/// Splitting on spaces alone is not enough, and the difference is not
/// cosmetic: `"one two\Nthree four"` splits into three space-separated
/// tokens, the middle one straddling the line break. Every consumer that
/// counts words -- the browser measuring loudness, the karaoke timer here
/// -- counts four. That off-by-one silently disabled emphasis on every cue
/// long enough to wrap, which is most of them.
enum Piece<'a> {
    /// An in-band line break. Carries no time and takes no space around it.
    Break,
    Word(&'a str),
}

/// Split escaped cue text into words and line breaks.
///
/// The input is already escaped, so the only backslash sequence that can
/// appear is the `\N` this crate inserted when joining lines.
fn pieces(text: &str) -> Vec<Piece<'_>> {
    let mut out = Vec::new();
    for (n, line) in text.split("\\N").enumerate() {
        if n > 0 {
            out.push(Piece::Break);
        }
        out.extend(line.split(' ').filter(|w| !w.is_empty()).map(Piece::Word));
    }
    out
}

/// Reassemble pieces, running `decorate(word_index, word)` over each word.
///
/// Spaces go between adjacent words only, never against a `\N`, so the
/// round trip through [`pieces`] cannot introduce a leading space on a
/// wrapped line.
fn render(pieces: &[Piece<'_>], mut decorate: impl FnMut(usize, &str) -> String) -> String {
    let mut out = String::new();
    let mut index = 0;
    let mut pending_space = false;
    for piece in pieces {
        match piece {
            Piece::Break => {
                out.push_str("\\N");
                pending_space = false;
            }
            Piece::Word(w) => {
                if pending_space {
                    out.push(' ');
                }
                out.push_str(&decorate(index, w));
                index += 1;
                pending_space = true;
            }
        }
    }
    out
}

fn word_count(pieces: &[Piece<'_>]) -> usize {
    pieces
        .iter()
        .filter(|p| matches!(p, Piece::Word(_)))
        .count()
}

fn emphasise(text: &str, levels: &[f32], base_size: i64, strength: f64) -> Option<String> {
    let parts = pieces(text);
    if word_count(&parts) != levels.len() || levels.is_empty() {
        return None;
    }
    Some(render(&parts, |i, word| {
        let value = f64::from(levels[i].clamp(0.0, 1.0));
        let size = (base_size as f64 * (1.0 + strength * value)).round() as i64;
        // Always emit the size, including for the quietest word: leaving it
        // implicit would let the previous word's override leak across the
        // space and grow the wrong text.
        format!("{{\\fs{size}}}{word}")
    }))
}

pub fn to_ass(cues: &[Cue], style: &StyleTemplate, play_res: (u32, u32)) -> String {
    to_ass_emphasised(cues, style, play_res, &[], 0.0)
}

/// The `[Script Info]`, `[V4+ Styles]` and `[Events]` preamble, plus the
/// resolved font size in pixels that every inline `\fs` override is
/// relative to.
fn document_header(style: &StyleTemplate, play_res: (u32, u32)) -> (String, i64) {
    let (w, h) = play_res;
    let font_size = (style.size_pct / 100.0 * f64::from(h)).round() as i64;
    let margin_v = (style.margin_v_pct / 100.0 * f64::from(h)).round() as i64;
    let bold = -i32::from(style.bold);
    let italic = -i32::from(style.italic);

    let mut out = String::new();

    out.push_str("[Script Info]\n");
    out.push_str("ScriptType: v4.00+\n");
    out.push_str("WrapStyle: 0\n");
    // Outlines and shadows must scale with PlayRes, or a template authored
    // at 1080p has hairline outlines at 4K.
    out.push_str("ScaledBorderAndShadow: yes\n");
    out.push_str("YCbCr Matrix: TV.709\n");
    let _ = writeln!(out, "PlayResX: {w}");
    let _ = writeln!(out, "PlayResY: {h}");

    out.push_str("\n[V4+ Styles]\n");
    out.push_str(
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,\
OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,\
Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,\
MarginV,Encoding\n",
    );
    let _ = writeln!(
        out,
        "Style: Default,{},{},{},{},{},{},{},{},0,0,100,100,0,0,{},{},{},{},20,20,{},1",
        sanitize_style_field(&style.font),
        font_size,
        style.primary.to_ass(),
        style.primary.to_ass(),
        style.outline_color.to_ass(),
        style.back_color.to_ass(),
        bold,
        italic,
        style.border_style.ass_value(),
        style.outline,
        style.shadow,
        style.alignment,
        margin_v,
    );

    out.push_str("\n[Events]\n");
    out.push_str("Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n");

    (out, font_size)
}

/// How much louder-than-average speech may grow the type, as a fraction.
///
/// 0.6 means the loudest word in a clip renders 60% larger than the
/// quietest. Past roughly this point the line starts reflowing between
/// cues, which reads as jitter rather than emphasis.
pub const MAX_EMPHASIS_STRENGTH: f64 = 0.6;

/// Render cues with per-word size emphasis driven by the audio.
///
/// `emphasis[i]` holds one value per whitespace-separated token of
/// `cues[i]`'s text, each in `0.0..=1.0`, where 1.0 is the loudest moment
/// in the clip. A cue with no matching entry — or a mismatched token count
/// — renders at the style's own size, because guessing which word a stray
/// value belongs to would put the emphasis on the wrong word, which is
/// worse than none at all.
///
/// `strength` scales the whole effect; 0.0 disables it entirely, which is
/// what `to_ass` passes.
///
/// # A caveat worth repeating downstream
///
/// This is only as accurate as the word timings it was measured against,
/// and those are synthesised — neither ffmpeg's `af_whisper` nor the
/// browser's ONNX Whisper reports real per-word times, so a word's span is
/// its share of the segment by character count. Loudness therefore lands
/// on approximately the right word. On a short emphatic word next to a
/// long quiet one it can land one word off.
pub fn to_ass_emphasised(
    cues: &[Cue],
    style: &StyleTemplate,
    play_res: (u32, u32),
    emphasis: &[Vec<f32>],
    strength: f64,
) -> String {
    let (out, font_size) = document_header(style, play_res);
    let mut out = out;
    let strength = strength.clamp(0.0, MAX_EMPHASIS_STRENGTH);

    for (i, c) in cues.iter().enumerate() {
        // Escape each line *before* joining: the `\N` separators added here
        // are the only backslashes allowed to survive as ASS syntax.
        //
        // ASS is line-oriented: a literal newline inside Dialogue would end
        // the event and corrupt the file. \N is the in-band line break.
        let plain = escaped_body(&c.lines);

        let text = match emphasis.get(i) {
            Some(levels) if strength > 0.0 => {
                emphasise(&plain, levels, font_size, strength).unwrap_or(plain)
            }
            _ => plain,
        };
        let _ = writeln!(
            out,
            "Dialogue: 0,{},{},Default,,0,0,0,,{}",
            fmt_ass(c.start),
            fmt_ass(c.end),
            text
        );
    }

    out
}

/// How small the supporting line of a bilingual subtitle may be set.
///
/// Below about half, the second language stops being readable at normal
/// viewing distance and becomes decoration.
pub const MIN_BILINGUAL_SCALE: f64 = 0.5;

/// Render two languages in one cue, each at its own size.
///
/// `top[i]` and `bottom[i]` are the same moment in two languages, so both
/// slices must be the same length and carry the same timings; the times
/// are taken from `top`. A length mismatch renders `top` alone rather than
/// pairing lines that do not correspond -- putting one language's line
/// against another's timing is worse than showing one language.
///
/// # Why this cannot be done by the caller
///
/// The obvious implementation is to merge the two line lists and hand them
/// to [`to_ass`], and that is exactly what the web app did first. It gives
/// both languages the same size, and it cannot do anything else: cue text
/// is run through [`escape_dialogue_text`], which turns `{` into `\{`
/// precisely so that text can never smuggle in an override. That escaping
/// is not an obstacle to work around -- it is what stops a subtitle file
/// rewriting the style -- so a per-line size has to be emitted here, where
/// the braces are ours rather than the user's.
pub fn to_ass_bilingual(
    top: &[Cue],
    bottom: &[Cue],
    style: &StyleTemplate,
    play_res: (u32, u32),
    top_scale: f64,
    bottom_scale: f64,
) -> String {
    if top.len() != bottom.len() {
        return to_ass(top, style, play_res);
    }

    let (mut out, font_size) = document_header(style, play_res);
    let top_scale = top_scale.clamp(MIN_BILINGUAL_SCALE, 1.0);
    let bottom_scale = bottom_scale.clamp(MIN_BILINGUAL_SCALE, 1.0);

    for (i, cue) in top.iter().enumerate() {
        let text = format!(
            "{}\\N{}",
            sized(&cue.lines, font_size, top_scale, style),
            sized(&bottom[i].lines, font_size, bottom_scale, style),
        );
        let _ = writeln!(
            out,
            "Dialogue: 0,{},{},Default,,0,0,0,,{}",
            fmt_ass(cue.start),
            fmt_ass(cue.end),
            text
        );
    }

    out
}

/// Which half of a bilingual cue carries the word effect.
///
/// Not a style preference. Word timings come from the speech the transcript
/// was made of, so the effect belongs to the language that was *spoken*: a
/// translation has its own word order and its own word count, and nothing
/// here knows which translated word matches which spoken one. Running a
/// highlight down the translation would march through it at the wrong pace.
///
/// This is why the effects used to switch themselves off the moment both
/// languages were shown -- which was the wrong conclusion from the right
/// observation. The spoken language is still on screen. It is the one that
/// lights up, and the translation sits quietly beside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectOn {
    Top,
    Bottom,
}

/// Karaoke on one language of a bilingual cue, the other drawn plainly.
///
/// Timings come from `top`, as in [`to_ass_bilingual`], so the two
/// languages cannot drift apart even if one arrived with its own rounding.
/// A length mismatch falls back to karaoke on `top` alone.
#[allow(clippy::too_many_arguments)]
pub fn to_ass_bilingual_karaoke(
    top: &[Cue],
    bottom: &[Cue],
    style: &StyleTemplate,
    play_res: (u32, u32),
    top_scale: f64,
    bottom_scale: f64,
    effect_on: EffectOn,
    strength: f64,
    glow: f64,
    accent: Rgba,
) -> String {
    if top.len() != bottom.len() {
        return to_ass_karaoke(top, style, play_res, strength, glow, accent);
    }

    let (mut out, font_size) = document_header(style, play_res);
    let top_scale = top_scale.clamp(MIN_BILINGUAL_SCALE, 1.0);
    let bottom_scale = bottom_scale.clamp(MIN_BILINGUAL_SCALE, 1.0);

    for (i, cue) in top.iter().enumerate() {
        let (lit, still, lit_scale, still_scale) = match effect_on {
            EffectOn::Top => (&cue.lines, &bottom[i].lines, top_scale, bottom_scale),
            EffectOn::Bottom => (&bottom[i].lines, &cue.lines, bottom_scale, top_scale),
        };
        // Reflowed here rather than inside the beat maths: the beats are
        // per word, and a cue that arrived pre-wrapped for one language on
        // its own must be put back on one line before a second goes under
        // it -- the same rule the plain bilingual writer follows.
        let spoken = Cue {
            start: cue.start,
            end: cue.end,
            lines: one_line(lit),
        };
        let quiet = sized_after_effects(still, font_size, still_scale, style);

        for (start, end, text) in
            karaoke_events(&spoken, style, font_size, strength, glow, accent, lit_scale)
        {
            let body = match effect_on {
                EffectOn::Top => format!("{text}\\N{quiet}"),
                EffectOn::Bottom => format!("{quiet}\\N{text}"),
            };
            let _ = writeln!(
                out,
                "Dialogue: 0,{},{},Default,,0,0,0,,{}",
                fmt_ass(start),
                fmt_ass(end),
                body
            );
        }
    }

    out
}

/// Loudness emphasis on one language of a bilingual cue.
///
/// `emphasis[i]` belongs to the language named by `effect_on`, which is the
/// one the audio was measured against. A cue whose word count no longer
/// matches its levels renders unemphasised, exactly as in
/// [`to_ass_emphasised`] -- sliding the sizes onto the wrong words is worse
/// than not sizing them.
#[allow(clippy::too_many_arguments)]
pub fn to_ass_bilingual_emphasised(
    top: &[Cue],
    bottom: &[Cue],
    style: &StyleTemplate,
    play_res: (u32, u32),
    top_scale: f64,
    bottom_scale: f64,
    effect_on: EffectOn,
    emphasis: &[Vec<f32>],
    strength: f64,
) -> String {
    if top.len() != bottom.len() {
        return to_ass_emphasised(top, style, play_res, emphasis, strength);
    }

    let (mut out, font_size) = document_header(style, play_res);
    let top_scale = top_scale.clamp(MIN_BILINGUAL_SCALE, 1.0);
    let bottom_scale = bottom_scale.clamp(MIN_BILINGUAL_SCALE, 1.0);
    let strength = strength.clamp(0.0, MAX_EMPHASIS_STRENGTH);

    for (i, cue) in top.iter().enumerate() {
        let (lit, still, lit_scale, still_scale) = match effect_on {
            EffectOn::Top => (&cue.lines, &bottom[i].lines, top_scale, bottom_scale),
            EffectOn::Bottom => (&bottom[i].lines, &cue.lines, bottom_scale, top_scale),
        };
        let px = scaled_size(font_size, lit_scale);
        let border = style.outline * lit_scale;
        let plain = escaped_body(&one_line(lit));
        // The per-word sizes are relative to this language's size, not the
        // document's, or the supporting line's loudest word would come back
        // up to the size the whole thing was scaled down from.
        let body = match emphasis.get(i) {
            Some(levels) if strength > 0.0 => {
                emphasise(&plain, levels, px, strength).unwrap_or(plain)
            }
            _ => plain,
        };
        let lit_text = format!("{{\\fs{px}\\bord{border:.2}}}{body}");
        let still_text = sized(still, font_size, still_scale, style);
        let text = match effect_on {
            EffectOn::Top => format!("{lit_text}\\N{still_text}"),
            EffectOn::Bottom => format!("{still_text}\\N{lit_text}"),
        };
        let _ = writeln!(
            out,
            "Dialogue: 0,{},{},Default,,0,0,0,,{}",
            fmt_ass(cue.start),
            fmt_ass(cue.end),
            text
        );
    }

    out
}

/// One language's lines, escaped and prefixed with its size override.
///
/// The override is emitted unconditionally, including at full size. An
/// `\fs` persists to the end of the Dialogue line, so the second language
/// has to state its size whatever the first one chose -- and stating both
/// makes the output the same shape however the two are ordered.
///
/// The outline scales with the type. `ScaledBorderAndShadow` scales
/// borders with PlayRes, not with an inline `\fs`, so a line set at 70%
/// with the full-size outline reads as noticeably heavier rather than
/// merely smaller.
fn sized(lines: &[String], font_size: i64, scale: f64, style: &StyleTemplate) -> String {
    let px = scaled_size(font_size, scale);
    let border = style.outline * scale;
    format!(
        "{{\\fs{px}\\bord{border:.2}}}{}",
        escaped_body(&one_line(lines))
    )
}

/// The same, but also putting the glow and the accent colour back.
///
/// `\fs` and `\bord` are the only things [`sized`] needs to restate,
/// because nothing else in a plain bilingual event changes them. Beside a
/// karaoke line that is no longer true: `\blur` and `\3c` persist to the
/// end of the Dialogue event, so a translation drawn after a highlighted
/// word inherits its halo and its accent colour and reads as though it
/// were being spoken too.
fn sized_after_effects(
    lines: &[String],
    font_size: i64,
    scale: f64,
    style: &StyleTemplate,
) -> String {
    let px = scaled_size(font_size, scale);
    let border = style.outline * scale;
    format!(
        "{{\\fs{px}\\bord{border:.2}\\blur0\\3c{}}}{}",
        style.outline_color.to_ass(),
        escaped_body(&one_line(lines))
    )
}

/// A language's lines, escaped and joined by in-band breaks.
///
/// ASS is line-oriented: a literal newline inside a Dialogue event ends the
/// event and corrupts the file, so `\N` is the only break available -- and
/// the separators added here are the only backslashes allowed to survive
/// [`escape_dialogue_text`].
///
/// Deliberately does *not* reflow. [`one_line`] belongs to the bilingual
/// writers, where a second language is being stacked underneath; applying
/// it here would silently rewrap every single-language cue as well.
fn escaped_body(lines: &[String]) -> String {
    lines
        .iter()
        .map(|l| escape_dialogue_text(l))
        .collect::<Vec<_>>()
        .join("\\N")
}

fn scaled_size(font_size: i64, scale: f64) -> i64 {
    ((font_size as f64) * scale).round().max(1.0) as i64
}

/// Put one language onto one line when the break in it was a machine's.
///
/// A cue arrives wrapped for a *monolingual* layout: two lines is the
/// ceiling, because a third covers too much picture. Stacking a second
/// language under that breaks the ceiling anyway -- two lines of English
/// above one of Chinese is three lines, and the first two read as a
/// duplicate rather than as one sentence. This was reported as a bug, and
/// the report was fair even though nothing was duplicated.
///
/// So a wrap that a machine chose is undone and each language gets a line
/// of its own. Nothing is lost by it: `WrapStyle: 0` means libass re-wraps
/// on width if the joined line genuinely does not fit, and it does that
/// knowing the size the line is actually being drawn at -- which the
/// original wrap, computed for full size, did not.
///
/// A break the *author* made is left alone. Two speakers in one cue are
/// marked with a leading dash by convention, and joining those turns two
/// people into one (`- Hello - Goodbye`), so a dashed cue keeps its break.
fn one_line(lines: &[String]) -> Vec<String> {
    if lines.len() < 2 || lines.iter().any(|l| is_speaker_line(l)) {
        return lines.to_vec();
    }
    // `join_tokens` rather than `join(" ")`: a Chinese line wrapped onto
    // two lines must not gain a space at the seam, which is exactly the
    // spacing bug this crate's sibling fixed for line breaking.
    let parts: Vec<&str> = lines.iter().map(|l| l.trim()).collect();
    vec![join_tokens(&parts)]
}

/// Whether a line opens with a speaker dash, in any of the three forms
/// subtitle authors actually type.
fn is_speaker_line(line: &str) -> bool {
    matches!(
        line.trim_start().chars().next(),
        Some('-' | '\u{2013}' | '\u{2014}')
    )
}

/// The two languages as a single cue list, for the text exports.
///
/// The burned picture and the exported `.srt` have to say the same thing,
/// so the reflow above cannot live only in the ASS writer -- a caller that
/// merged the lines itself would put a three-line cue in the `.srt` and a
/// two-line one in the video. Timings come from `top`; a length mismatch
/// returns `top` alone, matching [`to_ass_bilingual`].
pub fn merge_bilingual(top: &[Cue], bottom: &[Cue]) -> Vec<Cue> {
    if top.len() != bottom.len() {
        return top.to_vec();
    }
    top.iter()
        .enumerate()
        .map(|(i, cue)| {
            let mut lines = one_line(&cue.lines);
            lines.extend(one_line(&bottom[i].lines));
            Cue {
                start: cue.start,
                end: cue.end,
                lines,
            }
        })
        .collect()
}

/// Ceiling on the karaoke glow, as a fraction of the font size.
///
/// `\blur` past roughly this smears the glyph into an unreadable smudge
/// rather than haloing it.
pub const MAX_GLOW: f64 = 1.0;

/// CJK ideographs and kana, which are written without spaces.
///
/// A Chinese line is one whitespace token, so word-at-a-time highlighting
/// would light the entire line at once. Splitting these runs per character
/// is what makes the effect mean anything after translating.
fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{30FF}'   // kana
        | '\u{3400}'..='\u{4DBF}' // ext A
        | '\u{4E00}'..='\u{9FFF}' // unified
        | '\u{F900}'..='\u{FAFF}' // compatibility
        | '\u{FF66}'..='\u{FF9F}' // halfwidth kana
    )
}

/// Split a whitespace token into the units the highlight steps through.
///
/// Latin words stay whole. A token containing CJK is split so each
/// ideograph is its own beat, with runs of non-CJK (Latin, digits,
/// punctuation) kept together.
fn beats(word: &str) -> Vec<&str> {
    if !word.chars().any(is_cjk) {
        return vec![word];
    }
    let mut out = Vec::new();
    let mut run_start: Option<usize> = None;
    for (i, c) in word.char_indices() {
        if is_cjk(c) {
            if let Some(start) = run_start.take() {
                out.push(&word[start..i]);
            }
            out.push(&word[i..i + c.len_utf8()]);
        } else if run_start.is_none() {
            run_start = Some(i);
        }
    }
    if let Some(start) = run_start {
        out.push(&word[start..]);
    }
    out
}

/// Render cues so each word lights up at the moment it is spoken.
///
/// This is the effect people mean by "karaoke" or "TikTok captions": the
/// whole line is on screen throughout, and the word currently being said
/// grows and gains a coloured glow. It is a *time* effect, which is what
/// separates it from [`to_ass_emphasised`] -- that one sizes every word
/// once from how loud it was, so the line arrives fully formed and nothing
/// ever moves. Seen side by side, the loudness version reads as "this line
/// is styled" and this one reads as "the words are being spoken".
///
/// `strength` is how much the active word grows, as a fraction of the
/// style's size. `glow` is the halo, as a fraction of the font size,
/// applied as `\bord` plus libass's `\blur` -- a real gaussian blur of the
/// border, not an outline stack pretending to be one. `accent` colours
/// that halo.
///
/// ASS cannot animate a property per word within one event, so each cue
/// becomes one event per beat, each showing the full line with a different
/// word active. The events tile the cue exactly, so there is no frame where
/// the line disappears.
///
/// # The timings are synthesised
///
/// Each beat's span is its share of the cue by character count, because no
/// speech backend here reports real per-word times. The highlight therefore
/// drifts within a cue: it tracks the line's overall pace correctly but can
/// sit a word ahead or behind on a line mixing very short and very long
/// words. This needs only cue timings, though, so unlike loudness emphasis
/// it works on an imported `.srt` too.
pub fn to_ass_karaoke(
    cues: &[Cue],
    style: &StyleTemplate,
    play_res: (u32, u32),
    strength: f64,
    glow: f64,
    accent: Rgba,
) -> String {
    let (mut out, font_size) = document_header(style, play_res);
    for cue in cues {
        for (start, end, text) in karaoke_events(cue, style, font_size, strength, glow, accent, 1.0)
        {
            let _ = writeln!(
                out,
                "Dialogue: 0,{},{},Default,,0,0,0,,{}",
                fmt_ass(start),
                fmt_ass(end),
                text
            );
        }
    }
    out
}

/// One cue's karaoke events: a span of time, and the line to draw over it.
///
/// Split out of [`to_ass_karaoke`] so the bilingual writer can set the same
/// beats beside a second language instead of reimplementing them. Two
/// implementations of "which word is being said now" would drift apart, and
/// the one behind a checkbox is the one nobody would notice had drifted.
///
/// `scale` is the fraction of the style's size this language is drawn at.
/// Everything the effect touches scales with it -- the active size, the
/// glow, the blur -- so a supporting line pulses in proportion instead of
/// punching up to full size on every beat and out-shouting the language it
/// is supporting.
fn karaoke_events(
    cue: &Cue,
    style: &StyleTemplate,
    font_size: i64,
    strength: f64,
    glow: f64,
    accent: Rgba,
    scale: f64,
) -> Vec<(f64, f64, String)> {
    let strength = strength.clamp(0.0, MAX_EMPHASIS_STRENGTH);
    let glow = glow.clamp(0.0, MAX_GLOW);

    let size = font_size as f64 * scale;
    let base = scaled_size(font_size, scale);
    let active_size = (size * (1.0 + strength)).round() as i64;
    // Both derived from the font size so a 4K burn glows like a 720p one.
    let border = style.outline * scale;
    let active_border = border + glow * size * 0.06;
    let blur = glow * size * 0.08;
    let accent_ass = accent.to_ass();
    let outline_ass = style.outline_color.to_ass();

    let plain = escaped_body(&cue.lines);
    let parts = pieces(&plain);

    // Flatten to the list of beats in reading order, and remember which
    // word each belongs to so the renderer can rebuild the line.
    let words: Vec<&str> = parts
        .iter()
        .filter_map(|p| match p {
            Piece::Word(w) => Some(*w),
            Piece::Break => None,
        })
        .collect();
    let per_word: Vec<Vec<&str>> = words.iter().map(|w| beats(w)).collect();
    let total_beats: usize = per_word.iter().map(|b| b.len()).sum();

    if total_beats == 0 {
        // Nothing to light up. The size still has to be stated: this line
        // may be the supporting half of a bilingual cue, and an unsized one
        // would be drawn at the other language's size.
        return vec![(
            cue.start,
            cue.end,
            format!("{{\\fs{base}\\bord{border:.2}\\blur0\\3c{outline_ass}}}{plain}"),
        )];
    }

    // Beat boundaries, proportional to character count -- the same rule
    // the transcript uses to synthesise word times, so the highlight and
    // the loudness measurement agree about where a word sits.
    let widths: Vec<f64> = per_word
        .iter()
        .flatten()
        .map(|b| b.chars().count().max(1) as f64)
        .collect();
    let total: f64 = widths.iter().sum();
    let span = (cue.end - cue.start).max(0.001);
    let mut bounds = Vec::with_capacity(total_beats + 1);
    let mut cursor = cue.start;
    bounds.push(cue.start);
    for width in &widths {
        cursor += width / total * span;
        bounds.push(cursor);
    }
    // Snap the last boundary so rounding cannot leave a gap at the end
    // of the cue, which would blink the line off for a frame.
    let last = bounds.len() - 1;
    bounds[last] = cue.end;

    let mut events = Vec::with_capacity(total_beats);
    for active in 0..total_beats {
        let mut beat = 0usize;
        let text = render(&parts, |word_index, word| {
            let split = &per_word[word_index];
            let mut piece = String::new();
            for part in split {
                let is_active = beat == active;
                beat += 1;
                if is_active {
                    let _ = write!(
                        piece,
                        "{{\\fs{active_size}\\bord{active_border:.2}\\blur{blur:.2}\\3c{accent_ass}}}{part}"
                    );
                } else {
                    let _ = write!(
                        piece,
                        "{{\\fs{base}\\bord{border:.2}\\blur0\\3c{outline_ass}}}{part}"
                    );
                }
            }
            debug_assert!(!word.is_empty());
            piece
        });
        events.push((bounds[active], bounds[active + 1], text));
    }
    events
}

#[cfg(test)]
mod tests {

    fn bicue(start: f64, end: f64, text: &str) -> Cue {
        Cue {
            start,
            end,
            lines: vec![text.into()],
        }
    }

    #[test]
    fn bilingual_sets_each_language_at_its_own_size() {
        let top = [bicue(0.0, 1.0, "This is Sparta!")];
        let bottom = [bicue(0.0, 1.0, "这就是斯巴达！")];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 0.7, 1.0);
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        // Both languages, one event, two sizes, the smaller one first.
        assert!(line.contains("This is Sparta!"), "{line}");
        assert!(line.contains("这就是斯巴达！"), "{line}");
        let small = line.find("\\fs").unwrap();
        let large = line.rfind("\\fs").unwrap();
        assert!(small < large, "{line}");
        assert!(
            line.contains("\\N{"),
            "the two languages must be on separate lines: {line}"
        );
    }

    #[test]
    fn bilingual_scales_the_outline_with_the_type() {
        // ScaledBorderAndShadow scales with PlayRes, not with \fs, so a
        // 70% line kept the full-size outline and read as heavier.
        let top = [bicue(0.0, 1.0, "small")];
        let bottom = [bicue(0.0, 1.0, "big")];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 0.5, 1.0);
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let borders: Vec<&str> = line
            .match_indices("\\bord")
            .map(|(i, _)| &line[i + 5..i + 9])
            .collect();
        assert_eq!(borders.len(), 2, "{line}");
        assert_ne!(
            borders[0], borders[1],
            "both lines got the same outline: {line}"
        );
    }

    #[test]
    fn bilingual_falls_back_rather_than_pairing_mismatched_lines() {
        // One language having more cues than the other means the pairing
        // is wrong somewhere; showing one language beats showing a line
        // against someone else's timing.
        let top = [bicue(0.0, 1.0, "one"), bicue(1.0, 2.0, "two")];
        let bottom = [bicue(0.0, 1.0, "un")];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 1.0, 1.0);
        assert!(out.contains("one") && out.contains("two"), "{out}");
        assert!(!out.contains("un,"), "{out}");
        assert_eq!(
            out.lines().filter(|l| l.starts_with("Dialogue:")).count(),
            2
        );
    }

    #[test]
    fn word_effects_run_on_the_spoken_language_not_the_translation() {
        // The effects used to switch off whenever both languages were
        // shown. The language that was spoken is still on screen, and it is
        // the one whose words were timed.
        let spoken = [bicue(0.0, 2.0, "one two three")];
        let translated = [bicue(0.0, 2.0, "这就是斯巴达")];
        let out = to_ass_bilingual_karaoke(
            &spoken,
            &translated,
            &style(),
            (1920, 1080),
            0.8,
            1.0,
            EffectOn::Top,
            0.4,
            0.6,
            Rgba {
                r: 255,
                g: 212,
                b: 0,
                a: 255,
            },
        );
        let events: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        // One event per beat of the spoken line, not one per cue.
        assert_eq!(events.len(), 3, "{out}");
        for e in &events {
            // Both languages are on screen for every beat.
            assert!(e.contains("这就是斯巴达"), "{e}");
            assert!(
                e.contains("one") && e.contains("two") && e.contains("three"),
                "{e}"
            );
            // Exactly one word is lit at a time.
            assert_eq!(
                e.matches("\\blur").count() - e.matches("\\blur0").count(),
                1,
                "{e}"
            );
        }
    }

    #[test]
    fn the_translation_does_not_inherit_the_highlight() {
        // \blur and \3c persist to the end of a Dialogue event, so a
        // translation drawn after a lit word picks up its halo and its
        // accent colour and reads as though it were being spoken too.
        let spoken = [bicue(0.0, 2.0, "lit")];
        let translated = [bicue(0.0, 2.0, "quiet")];
        let out = to_ass_bilingual_karaoke(
            &spoken,
            &translated,
            &style(),
            (1920, 1080),
            1.0,
            1.0,
            EffectOn::Top,
            0.4,
            0.6,
            Rgba {
                r: 255,
                g: 212,
                b: 0,
                a: 255,
            },
        );
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let after = &line[line.find("quiet").unwrap() - 60..line.find("quiet").unwrap()];
        assert!(
            after.contains("\\blur0"),
            "the glow was not put back: {line}"
        );
        assert!(
            after.contains(&format!("\\3c{}", style().outline_color.to_ass())),
            "the accent colour was not put back: {line}"
        );
    }

    #[test]
    fn the_highlight_follows_the_original_when_the_translation_leads() {
        let original = [bicue(0.0, 2.0, "spoken words")];
        let translation = [bicue(0.0, 2.0, "traduction")];
        // Translation on top, so the effect is on the bottom half.
        let out = to_ass_bilingual_karaoke(
            &translation,
            &original,
            &style(),
            (1920, 1080),
            1.0,
            0.8,
            EffectOn::Bottom,
            0.4,
            0.6,
            Rgba {
                r: 255,
                g: 212,
                b: 0,
                a: 255,
            },
        );
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let text = &line[line.find(",,0,0,0,,").unwrap() + 9..];
        assert!(
            text.find("traduction").unwrap() < text.find("spoken").unwrap(),
            "the order was not kept: {line}"
        );
        // The lit word is in the second half, where the original is. The
        // accent colour is only ever written on the active beat.
        let accent = Rgba {
            r: 255,
            g: 212,
            b: 0,
            a: 255,
        }
        .to_ass();
        let lit = text
            .find(&format!("\\3c{accent}"))
            .expect("nothing was lit");
        assert!(lit > text.find("traduction").unwrap(), "{line}");
    }

    #[test]
    fn karaoke_events_tile_the_bilingual_cue_exactly() {
        // A gap between beats blinks both languages off for a frame.
        let spoken = [bicue(1.0, 3.0, "one two three four")];
        let translated = [bicue(1.0, 3.0, "un deux trois quatre")];
        let out = to_ass_bilingual_karaoke(
            &spoken,
            &translated,
            &style(),
            (1920, 1080),
            0.8,
            1.0,
            EffectOn::Top,
            0.4,
            0.6,
            Rgba {
                r: 255,
                g: 212,
                b: 0,
                a: 255,
            },
        );
        let events: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        let times: Vec<(&str, &str)> = events
            .iter()
            .map(|l| {
                let mut f = l.split(',');
                f.next();
                (f.next().unwrap(), f.next().unwrap())
            })
            .collect();
        assert_eq!(times.first().unwrap().0, "0:00:01.00", "{out}");
        assert_eq!(times.last().unwrap().1, "0:00:03.00", "{out}");
        for pair in times.windows(2) {
            assert_eq!(pair[0].1, pair[1].0, "a gap between beats: {out}");
        }
    }

    #[test]
    fn bilingual_emphasis_sizes_against_the_line_it_is_on() {
        // The supporting line is drawn smaller; its loudest word must not
        // come back up to the size the line was scaled down from.
        let spoken = [bicue(0.0, 2.0, "quiet loud")];
        let translated = [bicue(0.0, 2.0, "translation")];
        let levels = vec![vec![0.0f32, 1.0f32]];
        let out = to_ass_bilingual_emphasised(
            &spoken,
            &translated,
            &style(),
            (1920, 1080),
            0.5,
            1.0,
            EffectOn::Top,
            &levels,
            0.6,
        );
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let sizes: Vec<i64> = line
            .match_indices("\\fs")
            .map(|(i, _)| {
                line[i + 3..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap()
            })
            .collect();
        // The document size, from the style: 5% of 1080.
        let full = 54;
        assert!(
            sizes.contains(&full),
            "the translation lost its size: {line}"
        );
        // Half size, plus at most 60% emphasis, is still under full size.
        assert!(
            sizes.iter().filter(|s| **s != full).all(|s| *s < full),
            "an emphasised word on the half-size line reached full size: {line} {sizes:?}"
        );
    }

    #[test]
    fn bilingual_emphasis_leaves_the_translation_alone() {
        let spoken = [bicue(0.0, 2.0, "quiet loud")];
        let translated = [bicue(0.0, 2.0, "une traduction")];
        let levels = vec![vec![0.0f32, 1.0f32]];
        let out = to_ass_bilingual_emphasised(
            &spoken,
            &translated,
            &style(),
            (1920, 1080),
            0.8,
            1.0,
            EffectOn::Top,
            &levels,
            0.6,
        );
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let tail = &line[line.find("une").unwrap()..];
        assert!(
            !tail.contains("\\fs"),
            "the translation's words were sized individually: {line}"
        );
    }

    #[test]
    fn bilingual_puts_each_language_on_one_line() {
        // Reported as "two English and one Chinese subtitles". Nothing was
        // duplicated -- the English cue simply arrived wrapped onto two
        // lines, which is right on its own and wrong stacked under a
        // second language.
        let top = [Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["A second cue, on two".into(), "lines this time.".into()],
        }];
        let bottom = [bicue(0.0, 1.0, "这是第二行")];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 0.8, 1.0);
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let text = &line[line.find(",,0,0,0,,").unwrap()..];
        assert_eq!(
            text.matches("\\N").count(),
            1,
            "one break, between the languages, not two: {line}"
        );
        assert!(
            text.contains("A second cue, on two lines this time."),
            "{line}"
        );
    }

    #[test]
    fn bilingual_keeps_a_break_the_author_meant() {
        // A leading dash marks a second speaker. Joining those two lines
        // turns two people into one.
        let top = [Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["- Are you coming?".into(), "- In a minute.".into()],
        }];
        let bottom = [bicue(0.0, 1.0, "translated")];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 1.0, 1.0);
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        let text = &line[line.find(",,0,0,0,,").unwrap()..];
        assert_eq!(
            text.matches("\\N").count(),
            2,
            "the speakers were run together: {line}"
        );
    }

    #[test]
    fn rejoining_a_chinese_line_does_not_insert_a_space() {
        // The seam of a wrapped CJK line is not a word boundary.
        let top = [bicue(0.0, 1.0, "English")];
        let bottom = [Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["这是第一行".into(), "这是第二行".into()],
        }];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 0.8, 1.0);
        assert!(out.contains("这是第一行这是第二行"), "{out}");
    }

    #[test]
    fn the_text_export_is_reflowed_the_same_way_as_the_picture() {
        // The .srt and the burned video have to say the same thing.
        let top = [Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["A second cue, on two".into(), "lines this time.".into()],
        }];
        let bottom = [bicue(0.0, 1.0, "这是第二行")];
        let merged = merge_bilingual(&top, &bottom);
        assert_eq!(
            merged[0].lines,
            vec!["A second cue, on two lines this time.", "这是第二行"]
        );
        assert_eq!(merged[0].start, 0.0);
        assert_eq!(merged[0].end, 1.0);
    }

    #[test]
    fn merging_mismatched_languages_keeps_the_first_alone() {
        let top = [bicue(0.0, 1.0, "one"), bicue(1.0, 2.0, "two")];
        let bottom = [bicue(0.0, 1.0, "un")];
        assert_eq!(merge_bilingual(&top, &bottom), top.to_vec());
    }

    #[test]
    fn bilingual_still_escapes_the_text_it_is_given() {
        // The whole reason this lives in the engine is that cue text may
        // not carry overrides. It still may not.
        let top = [bicue(0.0, 1.0, "{\\fs200}huge")];
        let bottom = [bicue(0.0, 1.0, "ok")];
        let out = to_ass_bilingual(&top, &bottom, &style(), (1920, 1080), 1.0, 1.0);
        let line = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        assert!(line.contains("\\{"), "the brace was not escaped: {line}");
        assert!(
            !line.contains("{\\fs200}"),
            "an override survived from cue text: {line}"
        );
    }
    use super::*;
    use crate::{BorderStyle, Rgba, StyleTemplate};
    use subs_subtitle::Cue;

    fn style() -> StyleTemplate {
        StyleTemplate {
            name: "Bold".into(),
            font: "Inter".into(),
            size_pct: 5.0,
            primary: Rgba {
                r: 255,
                g: 255,
                b: 255,
                a: 255,
            },
            outline_color: Rgba {
                r: 0,
                g: 0,
                b: 0,
                a: 255,
            },
            back_color: Rgba {
                r: 0,
                g: 0,
                b: 0,
                a: 0,
            },
            bold: true,
            italic: false,
            border_style: BorderStyle::OutlineShadow,
            outline: 2.0,
            shadow: 0.0,
            alignment: 2,
            margin_v_pct: 6.0,
        }
    }

    fn cues() -> Vec<Cue> {
        vec![
            Cue {
                start: 0.0,
                end: 1.5,
                lines: vec!["Hello".into()],
            },
            Cue {
                start: 2.0,
                end: 3.0,
                lines: vec!["two".into(), "lines".into()],
            },
        ]
    }

    #[test]
    fn q4_play_res_matches_the_display_dimensions_exactly() {
        let out = to_ass(&cues(), &style(), (1080, 1920));
        assert!(out.contains("PlayResX: 1080"));
        assert!(out.contains("PlayResY: 1920"));
    }

    #[test]
    fn scaled_border_and_shadow_is_enabled() {
        // Without this, outlines do not scale with PlayRes and look wrong
        // at anything but the authoring resolution.
        assert!(to_ass(&cues(), &style(), (1280, 720)).contains("ScaledBorderAndShadow: yes"));
    }

    #[test]
    fn font_size_is_resolved_from_the_percentage_of_height() {
        // 5% of 720 = 36
        let out = to_ass(&cues(), &style(), (1280, 720));
        assert!(out.contains(",Inter,36,"), "styles line was: {out}");
    }

    #[test]
    fn multi_line_cues_use_the_ass_line_separator() {
        let out = to_ass(&cues(), &style(), (1280, 720));
        assert!(out.contains("two\\Nlines"));
        // A literal newline inside a Dialogue line would corrupt the file.
        assert!(!out.contains("two\nlines"));
    }

    #[test]
    fn dialogue_uses_centisecond_timecodes() {
        let out = to_ass(&cues(), &style(), (1280, 720));
        assert!(out.contains("0:00:00.00,0:00:01.50"));
    }

    #[test]
    fn required_sections_are_present_and_ordered() {
        let out = to_ass(&cues(), &style(), (1280, 720));
        let si = out.find("[Script Info]").unwrap();
        let st = out.find("[V4+ Styles]").unwrap();
        let ev = out.find("[Events]").unwrap();
        assert!(si < st && st < ev);
    }

    #[test]
    fn braces_in_cue_text_are_escaped_so_libass_cannot_swallow_the_word() {
        let cues = vec![Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["Hello {world} again".into()],
        }];
        let out = to_ass(&cues, &style(), (1280, 720));
        let dialogue = out
            .lines()
            .find(|l| l.starts_with("Dialogue:"))
            .expect("no Dialogue line");

        // An unescaped `{` opens an override block: everything up to the
        // matching `}` is parsed as style commands and drawn as nothing, so
        // "world" disappears from the burned video with no error at all.
        assert!(
            dialogue.ends_with("Hello \\{world\\} again"),
            "braces not escaped: {dialogue}"
        );
        assert!(!dialogue.contains("0,,Hello {"), "raw brace: {dialogue}");
    }

    #[test]
    fn a_backslash_in_cue_text_cannot_inject_a_line_break() {
        let cues = vec![Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["a\\Nb".into()],
        }];
        let out = to_ass(&cues, &style(), (1280, 720));
        let dialogue = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();

        // The literal text `a\Nb` must not reach libass as `a\Nb`, which it
        // would render as two lines. A WORD JOINER breaks the `\N` pair
        // without drawing anything. `\\` would NOT work: libass reparses
        // from the second backslash and still sees `\N`.
        assert!(dialogue.ends_with("a\\\u{2060}Nb"), "got: {dialogue}");
        assert!(!dialogue.ends_with("a\\Nb"));
    }

    #[test]
    fn all_three_special_characters_survive_together() {
        let cues = vec![Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["50% {of} c:\\dir".into()],
        }];
        let out = to_ass(&cues, &style(), (1280, 720));
        let dialogue = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        assert!(
            dialogue.ends_with("50% \\{of\\} c:\\\u{2060}dir"),
            "got: {dialogue}"
        );
    }

    #[test]
    fn escaping_happens_per_line_so_the_n_separator_still_works() {
        let cues = vec![Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["{first}".into(), "{second}".into()],
        }];
        let out = to_ass(&cues, &style(), (1280, 720));
        let dialogue = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        // The \N joining the two lines is real ASS syntax and must stay
        // unescaped; the braces inside each line must not.
        assert!(
            dialogue.ends_with("\\{first\\}\\N\\{second\\}"),
            "got: {dialogue}"
        );
    }

    #[test]
    fn a_comma_in_the_font_name_cannot_shift_every_style_field() {
        let mut s = style();
        s.font = "Ill,egal Sans".into();
        let out = to_ass(&cues(), &s, (1280, 720));
        let style_line = out
            .lines()
            .find(|l| l.starts_with("Style:"))
            .expect("no Style line");
        let format_line = out
            .lines()
            .find(|l| l.starts_with("Format: Name,Fontname"))
            .expect("no styles Format line");

        // The Style line is split positionally on commas with no escape
        // available, so one stray comma reads Fontsize out of the colour
        // column and corrupts the whole style, not just the font.
        assert!(!style_line.contains("Ill,egal"), "got: {style_line}");
        assert!(style_line.contains("Illegal Sans"), "got: {style_line}");
        assert_eq!(
            style_line.matches(',').count(),
            format_line.matches(',').count(),
            "Style field count no longer matches its Format line:\n{format_line}\n{style_line}"
        );
    }

    #[test]
    fn opaque_box_border_style_serialises_as_three() {
        let mut s = style();
        s.border_style = BorderStyle::OpaqueBox;
        assert!(to_ass(&cues(), &s, (1280, 720)).contains(",3,"));
    }

    fn emphasis_cue(text: &str) -> Vec<Cue> {
        vec![Cue {
            start: 0.0,
            end: 2.0,
            lines: vec![text.to_string()],
        }]
    }

    #[test]
    fn emphasis_sizes_each_word_by_its_own_level() {
        let style = crate::preset_by_name("Clean").unwrap();
        // 4.5% of 1000 = 45px base.
        let out = to_ass_emphasised(
            &emphasis_cue("quiet LOUD"),
            &style,
            (1920, 1000),
            &[vec![0.0, 1.0]],
            0.6,
        );
        let dialogue = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        assert!(dialogue.contains("{\\fs45}quiet"), "{dialogue}");
        // 45 * (1 + 0.6) = 72
        assert!(dialogue.contains("{\\fs72}LOUD"), "{dialogue}");
    }

    #[test]
    fn zero_strength_renders_exactly_what_to_ass_renders() {
        // The emphasis path must be invisible when it is switched off, or
        // every existing golden comparison silently changes meaning.
        let style = crate::preset_by_name("Bold").unwrap();
        let cues = emphasis_cue("one two three");
        assert_eq!(
            to_ass_emphasised(&cues, &style, (1920, 1080), &[vec![1.0, 1.0, 1.0]], 0.0),
            to_ass(&cues, &style, (1920, 1080)),
        );
    }

    #[test]
    fn a_mismatched_level_count_falls_back_rather_than_shifting_emphasis() {
        // Two levels for three words could only be applied by guessing,
        // and a guess puts the emphasis on the wrong word.
        let style = crate::preset_by_name("Clean").unwrap();
        let cues = emphasis_cue("one two three");
        let out = to_ass_emphasised(&cues, &style, (1920, 1080), &[vec![1.0, 1.0]], 0.6);
        assert_eq!(out, to_ass(&cues, &style, (1920, 1080)));
    }

    #[test]
    fn cues_without_an_emphasis_entry_are_left_alone() {
        let style = crate::preset_by_name("Clean").unwrap();
        let cues = vec![
            Cue {
                start: 0.0,
                end: 1.0,
                lines: vec!["first".into()],
            },
            Cue {
                start: 1.5,
                end: 2.5,
                lines: vec!["second".into()],
            },
        ];
        let out = to_ass_emphasised(&cues, &style, (1920, 1080), &[vec![1.0]], 0.6);
        let dialogues: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert!(dialogues[0].contains("\\fs"), "{}", dialogues[0]);
        assert!(!dialogues[1].contains("\\fs"), "{}", dialogues[1]);
    }

    #[test]
    fn a_line_break_is_never_swallowed_into_an_override() {
        let style = crate::preset_by_name("Clean").unwrap();
        let cues = vec![Cue {
            start: 0.0,
            end: 2.0,
            lines: vec!["one two".into(), "three four".into()],
        }];
        let out = to_ass_emphasised(
            &cues,
            &style,
            (1920, 1080),
            &[vec![0.2, 0.4, 0.6, 0.8]],
            0.6,
        );
        let dialogue = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        assert!(
            dialogue.contains("\\N"),
            "the line break was lost: {dialogue}"
        );
        assert!(
            !dialogue.contains("fs\\N"),
            "a break landed inside an override"
        );
        for word in ["one", "two", "three", "four"] {
            assert!(dialogue.contains(word), "{word} missing from {dialogue}");
        }
    }

    #[test]
    fn strength_is_capped_so_the_line_cannot_run_away() {
        let style = crate::preset_by_name("Clean").unwrap();
        let huge = to_ass_emphasised(
            &emphasis_cue("word"),
            &style,
            (1920, 1000),
            &[vec![1.0]],
            99.0,
        );
        let capped = to_ass_emphasised(
            &emphasis_cue("word"),
            &style,
            (1920, 1000),
            &[vec![1.0]],
            MAX_EMPHASIS_STRENGTH,
        );
        assert_eq!(huge, capped);
    }

    #[test]
    fn every_word_carries_an_explicit_size() {
        // Without one, the previous word's override leaks across the space
        // and enlarges text that should be small.
        let style = crate::preset_by_name("Clean").unwrap();
        let out = to_ass_emphasised(
            &emphasis_cue("a b c"),
            &style,
            (1920, 1080),
            &[vec![1.0, 0.0, 0.5]],
            0.6,
        );
        let dialogue = out.lines().find(|l| l.starts_with("Dialogue:")).unwrap();
        assert_eq!(dialogue.matches("\\fs").count(), 3, "{dialogue}");
    }

    fn cue(start: f64, end: f64, lines: &[&str]) -> Cue {
        Cue {
            start,
            end,
            lines: lines.iter().map(|l| (*l).to_string()).collect(),
        }
    }

    fn dialogue(doc: &str) -> Vec<&str> {
        doc.lines().filter(|l| l.starts_with("Dialogue:")).collect()
    }

    const ACCENT: Rgba = Rgba {
        r: 255,
        g: 212,
        b: 0,
        a: 255,
    };

    #[test]
    fn emphasis_survives_a_line_break() {
        // Regression: the old tokeniser split on spaces alone, so
        // "two\Nthree" counted as one word. Every wrapped cue then failed
        // the count check and rendered plain -- silently, with the feature
        // switched on.
        let cues = vec![cue(0.0, 2.0, &["one two", "three four"])];
        let levels = vec![vec![0.0, 0.5, 0.5, 1.0]];
        let doc = to_ass_emphasised(&cues, &style(), (1920, 1080), &levels, 0.5);
        let line = dialogue(&doc)[0];
        assert_eq!(line.matches("\\fs").count(), 4, "{line}");
        assert!(line.contains("\\N"), "the line break must survive: {line}");
        assert!(!line.contains(" \\N"), "no space against the break: {line}");
    }

    #[test]
    fn karaoke_emits_one_event_per_word_tiling_the_cue() {
        let cues = vec![cue(1.0, 4.0, &["This is Sparta"])];
        let doc = to_ass_karaoke(&cues, &style(), (1920, 1080), 0.5, 0.6, ACCENT);
        let events = dialogue(&doc);
        assert_eq!(events.len(), 3, "one event per word");
        // Every event carries the whole line; only the active word differs.
        for e in &events {
            assert!(
                e.contains("This") && e.contains("is") && e.contains("Sparta"),
                "{e}"
            );
        }
        assert!(
            events[0].contains("0:00:01.00"),
            "starts at the cue: {}",
            events[0]
        );
        assert!(
            events[2].contains("0:00:04.00"),
            "ends at the cue: {}",
            events[2]
        );
    }

    #[test]
    fn karaoke_moves_the_highlight_along_the_line() {
        let cues = vec![cue(0.0, 3.0, &["alpha beta gamma"])];
        let doc = to_ass_karaoke(&cues, &style(), (1920, 1080), 0.5, 0.6, ACCENT);
        let events = dialogue(&doc);
        // The glow must sit on a different word in each event -- this is the
        // whole difference from loudness emphasis, where nothing moves.
        for (n, word) in ["alpha", "beta", "gamma"].iter().enumerate() {
            let blurred = events[n]
                .split("{")
                .find(|chunk| chunk.contains("\\blur") && !chunk.contains("\\blur0"))
                .unwrap_or_else(|| panic!("no glowing word in {}", events[n]));
            assert!(
                blurred.contains(word),
                "event {n} glows the wrong word: {}",
                events[n]
            );
        }
    }

    #[test]
    fn karaoke_splits_chinese_per_character() {
        // A Chinese line is a single whitespace token, so without this the
        // highlight would light the whole line at once and mean nothing.
        let cues = vec![cue(0.0, 2.0, &["这是斯巴达"])];
        let doc = to_ass_karaoke(&cues, &style(), (1920, 1080), 0.4, 0.5, ACCENT);
        assert_eq!(dialogue(&doc).len(), 5, "one beat per ideograph");
    }

    #[test]
    fn karaoke_needs_no_audio() {
        // Unlike loudness emphasis this runs off cue timings alone, so an
        // imported .srt gets the effect too.
        let cues = vec![cue(0.0, 1.0, &["hello world"])];
        let doc = to_ass_karaoke(&cues, &style(), (1280, 720), 0.4, 0.5, ACCENT);
        assert_eq!(dialogue(&doc).len(), 2);
    }

    #[test]
    fn karaoke_glow_and_growth_are_capped() {
        let cues = vec![cue(0.0, 1.0, &["x y"])];
        let wild = to_ass_karaoke(&cues, &style(), (1920, 1080), 99.0, 99.0, ACCENT);
        let capped = to_ass_karaoke(
            &cues,
            &style(),
            (1920, 1080),
            MAX_EMPHASIS_STRENGTH,
            MAX_GLOW,
            ACCENT,
        );
        assert_eq!(wild, capped, "out-of-range values must clamp, not run away");
    }
}
