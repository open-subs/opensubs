use crate::{BorderStyle, Rgba, StyleTemplate};
use std::fmt::Write as _;
use subs_subtitle::width::is_cjk_spacing;
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

/// A line break this writer chose, held as one character until the event
/// text is finished and then written out as `\N`.
///
/// Not `\N` straight away, because everything between here and the output
/// counts words -- loudness emphasis matches one level to each word, and
/// karaoke steps through them -- and [`pieces`] reads `\N` as the end of a
/// word. A break placed inside a Chinese sentence, which is a single word,
/// would turn one word into two and silently switch both effects off. A
/// private-use character is part of the word it sits in until
/// [`finish_breaks`] turns it into the break libass needs.
const FIT_BREAK: char = '\u{E0B0}';

/// Characters a line may not begin with.
///
/// Closing punctuation and small kana belong to the character before them.
/// A line opening on `，` or `。` reads as if the break were a mistake --
/// which in Chinese and Japanese typography it would be.
const NO_LINE_START: &str = "，。、！？：；）」』】〉》〕］｝”’…‥ー々ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ,.!?;:)]}%";

/// Characters a line may not end with: the opening half of a pair.
const NO_LINE_END: &str = "（「『【〈《〔［｛“‘([{";

/// Hangul, which is written with spaces between words.
fn is_hangul(c: char) -> bool {
    matches!(c as u32, 0x1100..=0x11FF | 0x3130..=0x318F | 0xAC00..=0xD7AF)
}

/// Whether libass could never break between `a` and `b` on its own.
///
/// `WrapStyle: 0` wraps at spaces and nowhere else, so a Chinese or Japanese
/// sentence -- which has none -- is laid out on one line however wide the
/// frame is (APP-90). Korean is excluded on purpose: it puts spaces between
/// words, libass already wraps it there, and splitting a word between two
/// syllables would be worse than the wrap it gets today.
fn unspaced_boundary(a: char, b: char) -> bool {
    is_cjk_spacing(a) && is_cjk_spacing(b) && !is_hangul(a) && !is_hangul(b)
}

/// How far one ideograph advances, as a share of the ASS font size.
///
/// Not 1.0. libass sizes a face so its *line height* -- ascender plus
/// descender -- equals the font size, and CJK faces carry generous line
/// metrics: the one this app ships (`opensubs-cjk`) is 1.448 em tall and
/// sets each ideograph on 1 em, so an ideograph advances 0.691 of the size.
/// Measured on a burned 360x640 frame: 28.5 px per character at size 42.
/// PingFang, which the desktop build finds through fontconfig, comes out
/// the same. Estimating a full em wrapped Shorts at 6 characters where 12
/// fit, and spent five lines of picture on a two-line sentence.
///
/// A hair over the measured value, so a face with slightly tighter line
/// metrics still does not clip. The first cut, 0.72 with a 6% margin on
/// top, stacked two safeties and set Shorts on four lines where three fit
/// with room to spare.
const CJK_ADVANCE: f64 = 0.70;

/// Estimated advance of one character, in pixels, at font size `px`.
///
/// Latin is an average, and only has to be close: a line containing it has
/// spaces, and libass does the wrapping there.
fn advance(c: char, px: f64) -> f64 {
    if c == ' ' {
        0.25 * px
    } else if is_cjk_spacing(c) {
        CJK_ADVANCE * px
    } else {
        0.45 * px
    }
}

/// How wide a line of text may be, in PlayRes pixels, for text set at `px`.
///
/// The frame less the style's side margins (20 each, written by
/// [`document_header`]) and the border on both sides, with 3% kept back:
/// glyph advances vary a little between faces, and a subtitle that is a
/// character too wide loses that character off both edges.
fn line_room(style: &StyleTemplate, play_res: (u32, u32), px: f64, scale: f64) -> f64 {
    let border = border_width(style, px, scale);
    (f64::from(play_res.0) - 40.0 - 2.0 * border).max(px) * 0.97
}

/// Mark where a line of Chinese or Japanese has to break to fit the frame.
///
/// APP-90. A vertical 360x640 video burned a 28-character Chinese cue on a
/// single line about twice the width of the frame, and the characters past
/// either edge were simply gone. English of the same length wrapped onto
/// four lines, because it has spaces for libass to break at.
///
/// So this places breaks only where libass cannot -- between two unspaced
/// characters -- and leaves every space to libass, which measures the real
/// glyphs. The lines are balanced rather than filled greedily, so a cue
/// comes out 10 / 10 / 8 rather than 13 / 13 / 2, and no line starts on
/// closing punctuation or ends on opening punctuation.
///
/// It depends on the frame, which the cue does not know: the same cue fits
/// on one line of a 1920-wide landscape video. That is why it lives here,
/// where the frame is known, and not in the segmenter.
fn fit_lines(lines: &[String], room: f64, px: f64) -> Vec<String> {
    lines.iter().map(|line| fit_line(line, room, px)).collect()
}

fn fit_line(line: &str, room: f64, px: f64) -> String {
    // A break character arriving in the text itself would be turned into a
    // real line break at the end. Nothing legitimate uses it.
    let chars: Vec<char> = line.chars().filter(|&c| c != FIT_BREAK).collect();
    let widths: Vec<f64> = chars.iter().map(|&c| advance(c, px)).collect();
    let total: f64 = widths.iter().sum();
    if total <= room || chars.len() < 2 || px <= 0.0 {
        return chars.into_iter().collect();
    }

    // As many lines as the text needs, each aiming at an equal share of
    // what is *left* -- recomputed after every break, which is what makes a
    // 29-character cue come out 7 / 7 / 8 / 7 rather than 8 / 8 / 8 / 5 or
    // 7 / 7 / 7 / 7 / 1. Half a character of slack lets a share that falls
    // between two characters round up instead of spilling a line.
    let mut lines_left = (total / room).ceil().max(1.0);
    let share = |remaining: f64, lines: f64| (remaining / lines + 0.5 * CJK_ADVANCE * px).min(room);
    let mut limit = share(total, lines_left);

    let mut breaks = Vec::new();
    let mut line_start = 0.0; // running width at the start of the current line
    let mut last_break = 0usize;
    let mut candidate: Option<(usize, f64)> = None;
    let mut running = 0.0;
    for i in 0..chars.len() {
        if i > last_break
            && unspaced_boundary(chars[i - 1], chars[i])
            && !NO_LINE_START.contains(chars[i])
            && !NO_LINE_END.contains(chars[i - 1])
        {
            candidate = Some((i, running));
        }
        if running + widths[i] - line_start > limit {
            if let Some((at, width_there)) = candidate.take() {
                breaks.push(at);
                last_break = at;
                line_start = width_there;
                lines_left = (lines_left - 1.0).max(1.0);
                limit = share(total - width_there, lines_left);
            }
        }
        running += widths[i];
    }

    let mut out = String::with_capacity(line.len() + breaks.len() * 3);
    let mut next = breaks.iter().peekable();
    for (i, c) in chars.into_iter().enumerate() {
        if next.peek() == Some(&&i) {
            out.push(FIT_BREAK);
            next.next();
        }
        out.push(c);
    }
    out
}

/// Turn the breaks [`fit_lines`] placed into the `\N` libass reads.
///
/// Called once on each finished document, after every effect has counted
/// its words.
fn finish_breaks(doc: String) -> String {
    if doc.contains(FIT_BREAK) {
        doc.replace(FIT_BREAK, "\\N")
    } else {
        doc
    }
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

/// How far an opaque box reaches past its text, as a share of the size the
/// text is set at, so the box keeps its proportions at any size and any
/// bilingual scale.
const BOX_PADDING_EM: f64 = 0.2;

/// The colour libass draws in the border slot.
///
/// For `OpaqueBox` that slot is the box. libass, like VSFilter before it,
/// paints BorderStyle=3's box in OutlineColour and pads it by Outline, and
/// uses BackColour only for the shadow. The template calls the box colour
/// `back_color`, which is how every other reader of it treats the field --
/// the /styles page, the style tiles -- so the translation happens here
/// rather than in the presets. Writing the fields across verbatim is what
/// left Boxed, Podcast and Reel Box with no box at all (APP-83).
fn border_colour(style: &StyleTemplate) -> Rgba {
    match style.border_style {
        BorderStyle::OpaqueBox => style.back_color,
        BorderStyle::OutlineShadow => style.outline_color,
    }
}

/// The border width for text set at `px`, which is `scale` of the style's
/// own size.
///
/// An outline scales with the type. A box's width is its padding, and it
/// has to be above zero: libass draws no box at all for BorderStyle=3 with
/// Outline=0.
fn border_width(style: &StyleTemplate, px: f64, scale: f64) -> f64 {
    match style.border_style {
        BorderStyle::OpaqueBox => (px * BOX_PADDING_EM * 100.0).round() / 100.0,
        BorderStyle::OutlineShadow => style.outline * scale,
    }
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
        border_colour(style).to_ass(),
        style.back_color.to_ass(),
        bold,
        italic,
        style.border_style.ass_value(),
        border_width(style, font_size as f64, 1.0),
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
    let room = line_room(style, play_res, font_size as f64, 1.0);

    for (i, c) in cues.iter().enumerate() {
        // Escape each line *before* joining: the `\N` separators added here
        // are the only backslashes allowed to survive as ASS syntax.
        //
        // ASS is line-oriented: a literal newline inside Dialogue would end
        // the event and corrupt the file. \N is the in-band line break.
        let plain = escaped_body(&fit_lines(&c.lines, room, font_size as f64));

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

    finish_breaks(out)
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
            sized(&cue.lines, font_size, top_scale, style, play_res),
            sized(&bottom[i].lines, font_size, bottom_scale, style, play_res),
        );
        let _ = writeln!(
            out,
            "Dialogue: 0,{},{},Default,,0,0,0,,{}",
            fmt_ass(cue.start),
            fmt_ass(cue.end),
            text
        );
    }

    finish_breaks(out)
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
        let quiet = sized_after_effects(still, font_size, still_scale, style, play_res);

        for (start, end, text) in karaoke_events(
            &spoken, style, play_res, font_size, strength, glow, accent, lit_scale,
        ) {
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

    finish_breaks(out)
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
        let border = border_width(style, px as f64, lit_scale);
        let room = line_room(style, play_res, px as f64, lit_scale);
        let plain = escaped_body(&fit_lines(&one_line(lit), room, px as f64));
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
        let still_text = sized(still, font_size, still_scale, style, play_res);
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

    finish_breaks(out)
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
fn sized(
    lines: &[String],
    font_size: i64,
    scale: f64,
    style: &StyleTemplate,
    play_res: (u32, u32),
) -> String {
    let px = scaled_size(font_size, scale);
    let border = border_width(style, px as f64, scale);
    let room = line_room(style, play_res, px as f64, scale);
    format!(
        "{{\\fs{px}\\bord{border:.2}}}{}",
        escaped_body(&fit_lines(&one_line(lines), room, px as f64))
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
    play_res: (u32, u32),
) -> String {
    let px = scaled_size(font_size, scale);
    let border = border_width(style, px as f64, scale);
    let room = line_room(style, play_res, px as f64, scale);
    format!(
        "{{\\fs{px}\\bord{border:.2}\\blur0\\3c{}}}{}",
        border_colour(style).to_ass(),
        escaped_body(&fit_lines(&one_line(lines), room, px as f64))
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
    // A fitted line break is not a beat. It is carried on the front of the
    // character after it, so it lands in the same place in every event and
    // never becomes a moment where nothing on screen is lit.
    let mut carried: Option<usize> = None;
    for (i, c) in word.char_indices() {
        if c == FIT_BREAK {
            if let Some(start) = run_start.take() {
                out.push(&word[start..i]);
            }
            carried.get_or_insert(i);
        } else if is_cjk(c) {
            if let Some(start) = run_start.take() {
                out.push(&word[start..i]);
            }
            let from = carried.take().unwrap_or(i);
            out.push(&word[from..i + c.len_utf8()]);
        } else if run_start.is_none() {
            run_start = Some(carried.take().unwrap_or(i));
        }
    }
    if let Some(start) = carried {
        run_start.get_or_insert(start);
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
        for (start, end, text) in
            karaoke_events(cue, style, play_res, font_size, strength, glow, accent, 1.0)
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
    finish_breaks(out)
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
#[allow(clippy::too_many_arguments)]
fn karaoke_events(
    cue: &Cue,
    style: &StyleTemplate,
    play_res: (u32, u32),
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
    let border = border_width(style, size, scale);
    let active_border = border + glow * size * 0.06;
    let blur = glow * size * 0.08;
    let accent_ass = accent.to_ass();
    let outline_ass = border_colour(style).to_ass();

    // Fitted before the beats are counted, so a break inside a Chinese line
    // travels with the character after it rather than becoming a beat.
    let room = line_room(style, play_res, size, scale);
    let plain = escaped_body(&fit_lines(&cue.lines, room, size));
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
        .map(|b| b.chars().filter(|&c| c != FIT_BREAK).count().max(1) as f64)
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

    /// Shaped like the shipped `Podcast` and `Reel Box`: the box colour in
    /// `back_color`, no outline.
    fn boxed() -> StyleTemplate {
        StyleTemplate {
            border_style: BorderStyle::OpaqueBox,
            outline: 0.0,
            back_color: Rgba {
                r: 12,
                g: 12,
                b: 16,
                a: 178,
            },
            ..style()
        }
    }

    /// One named field of the document's `Style:` line.
    fn style_field(ass: &str, name: &str) -> String {
        let names = ass
            .lines()
            .find_map(|l| l.strip_prefix("Format: Name,"))
            .expect("styles format line");
        let values = ass
            .lines()
            .find_map(|l| l.strip_prefix("Style: "))
            .expect("style line");
        std::iter::once("Name")
            .chain(names.split(','))
            .zip(values.split(','))
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.to_string())
            .unwrap_or_else(|| panic!("no {name} in {values}"))
    }

    /// Every `\bord` value and every `\3c` colour in a document's events.
    fn overrides(ass: &str) -> (Vec<f64>, Vec<String>) {
        let events: Vec<&str> = ass.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        let mut borders = Vec::new();
        let mut colours = Vec::new();
        for event in events {
            for (i, _) in event.match_indices("\\bord") {
                let rest = &event[i + 5..];
                let end = rest
                    .find(|c: char| !(c.is_ascii_digit() || c == '.'))
                    .unwrap_or(rest.len());
                borders.push(rest[..end].parse().expect("numeric \\bord"));
            }
            for (i, _) in event.match_indices("\\3c") {
                let rest = &event[i + 3..];
                colours.push(rest[..rest.find(['\\', '}']).unwrap_or(rest.len())].to_string());
            }
        }
        (borders, colours)
    }

    #[test]
    fn an_opaque_box_is_coloured_and_sized_where_libass_reads_them() {
        // APP-83. For BorderStyle=3 libass paints the box in OutlineColour
        // and pads it by Outline; BackColour is only the shadow. Copying the
        // template's fields straight across left Outline=0, and libass draws
        // no box at all for that.
        let s = boxed();
        let out = to_ass(&cues(), &s, (1280, 720));
        assert_eq!(style_field(&out, "OutlineColour"), s.back_color.to_ass());
        let pad: f64 = style_field(&out, "Outline").parse().unwrap();
        assert!(pad > 0.0, "Outline={pad} draws no box");
    }

    #[test]
    fn an_outline_style_keeps_its_own_outline_in_the_header() {
        let s = style();
        let out = to_ass(&cues(), &s, (1280, 720));
        assert_eq!(style_field(&out, "OutlineColour"), s.outline_color.to_ass());
        assert_eq!(style_field(&out, "Outline"), "2");
    }

    #[test]
    fn no_inline_override_takes_the_box_away_again() {
        // `\bord` and `\3c` restate the border mid-line in the bilingual and
        // karaoke writers. In box mode those are the box's padding and
        // colour, so an override carrying the outline's values would draw
        // the box in the plain export and remove it in these.
        let s = boxed();
        let accent = Rgba {
            r: 255,
            g: 214,
            b: 10,
            a: 255,
        };
        let docs = [
            to_ass_bilingual(&cues(), &cues(), &s, (1280, 720), 1.0, 0.7),
            to_ass_karaoke(&cues(), &s, (1280, 720), 0.3, 0.0, accent),
            to_ass_bilingual_karaoke(
                &cues(),
                &cues(),
                &s,
                (1280, 720),
                1.0,
                0.7,
                EffectOn::Top,
                0.3,
                0.0,
                accent,
            ),
        ];
        for doc in &docs {
            let (borders, colours) = overrides(doc);
            assert!(!borders.is_empty(), "no \\bord to check in:\n{doc}");
            assert!(
                borders.iter().all(|b| *b > 0.0),
                "a zero \\bord: {borders:?}"
            );
            for c in colours.iter().filter(|c| **c != accent.to_ass()) {
                assert_eq!(*c, s.back_color.to_ass(), "box recoloured in:\n{doc}");
            }
        }
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

    // --- APP-90: Chinese and Japanese fitted to the frame ------------------
    //
    // thea's reproduction: a 360x640 video and one 28-character Chinese cue.
    // Burned, it was a single line twice the frame's width with the ends cut
    // off, while English of the same length wrapped onto four lines.

    const LONG_ZH: &str = "我们今天要介绍的是一个可以在浏览器里直接生成字幕的免费工具";
    const VERTICAL: (u32, u32) = (360, 640);

    /// The text of the first Dialogue event, split at its line breaks.
    fn rendered_lines(doc: &str) -> Vec<String> {
        let event = dialogue(doc)[0];
        let text = event.splitn(10, ',').nth(9).unwrap();
        text.split("\\N").map(str::to_string).collect()
    }

    fn room_for(play_res: (u32, u32)) -> f64 {
        let st = style();
        let px = (st.size_pct / 100.0 * f64::from(play_res.1)).round();
        line_room(&st, play_res, px, 1.0) / (CJK_ADVANCE * px) // in ideographs
    }

    #[test]
    fn a_long_chinese_cue_is_broken_to_fit_a_vertical_frame() {
        let doc = to_ass(&[cue(1.0, 4.0, &[LONG_ZH])], &style(), VERTICAL);
        let lines = rendered_lines(&doc);
        assert!(lines.len() >= 2, "still one line: {lines:?}");
        let fits = room_for(VERTICAL);
        for line in &lines {
            assert!(
                (line.chars().count() as f64) <= fits,
                "{} characters where {fits:.1} fit: {line}",
                line.chars().count()
            );
        }
        assert_eq!(lines.concat(), LONG_ZH, "fitting must not lose or add text");
    }

    #[test]
    fn fitted_lines_are_balanced_rather_than_filled() {
        let doc = to_ass(&[cue(1.0, 4.0, &[LONG_ZH])], &style(), VERTICAL);
        let counts: Vec<usize> = rendered_lines(&doc)
            .iter()
            .map(|l| l.chars().count())
            .collect();
        let (lo, hi) = (counts.iter().min().unwrap(), counts.iter().max().unwrap());
        assert!(hi - lo <= 2, "unbalanced lines: {counts:?}");
    }

    #[test]
    fn the_same_cue_on_a_wide_frame_is_left_on_one_line() {
        let doc = to_ass(&[cue(1.0, 4.0, &[LONG_ZH])], &style(), (1920, 1080));
        assert_eq!(rendered_lines(&doc), vec![LONG_ZH.to_string()]);
    }

    #[test]
    fn english_is_left_for_libass_to_wrap() {
        // It has spaces, and libass already breaks at them measuring the
        // real glyphs -- which is why English was never cut off.
        let text =
            "Today we are introducing a free tool that makes subtitles right in your browser";
        let doc = to_ass(&[cue(1.0, 4.0, &[text])], &style(), VERTICAL);
        assert_eq!(rendered_lines(&doc), vec![text.to_string()]);
    }

    #[test]
    fn korean_is_not_split_between_syllables() {
        let text = "오늘은 브라우저에서 바로 자막을 만들어 주는 무료 도구를 소개하겠습니다";
        let doc = to_ass(&[cue(1.0, 4.0, &[text])], &style(), VERTICAL);
        assert_eq!(rendered_lines(&doc), vec![text.to_string()]);
    }

    #[test]
    fn no_fitted_line_starts_on_closing_punctuation() {
        let text =
            "我们今天，要介绍的是，一个可以在浏览器里，直接生成字幕的，免费工具。真的很好用。";
        for width in [300u32, 330, 360, 390, 420] {
            let doc = to_ass(&[cue(1.0, 4.0, &[text])], &style(), (width, 640));
            let lines = rendered_lines(&doc);
            for line in lines.iter().skip(1) {
                let first = line.chars().next().unwrap();
                assert!(
                    !NO_LINE_START.contains(first),
                    "{width}px: a line starts with {first}: {lines:?}"
                );
            }
            assert_eq!(lines.concat(), text);
        }
    }

    #[test]
    fn japanese_is_fitted_too() {
        let text = "今日はブラウザの中で直接字幕を作れる無料のツールを紹介します";
        let doc = to_ass(&[cue(1.0, 4.0, &[text])], &style(), VERTICAL);
        assert!(rendered_lines(&doc).len() >= 2);
    }

    #[test]
    fn a_break_character_in_the_text_cannot_inject_a_line_break() {
        let doc = to_ass(&[cue(1.0, 4.0, &["短\u{E0B0}句"])], &style(), VERTICAL);
        assert_eq!(rendered_lines(&doc), vec!["短句".to_string()]);
        assert!(!doc.contains('\u{E0B0}'));
    }

    #[test]
    fn karaoke_still_lights_every_character_once_when_fitted() {
        let wide = to_ass_karaoke(
            &[cue(1.0, 4.0, &[LONG_ZH])],
            &style(),
            (1920, 1080),
            0.3,
            0.5,
            ACCENT,
        );
        let narrow = to_ass_karaoke(
            &[cue(1.0, 4.0, &[LONG_ZH])],
            &style(),
            VERTICAL,
            0.3,
            0.5,
            ACCENT,
        );
        assert_eq!(
            dialogue(&wide).len(),
            dialogue(&narrow).len(),
            "a fitted break must not become a beat of its own"
        );
        assert_eq!(dialogue(&narrow).len(), LONG_ZH.chars().count());
        // And every beat breaks the line in the same places, or the text
        // would jump between lines as the highlight moves.
        let shape: Vec<usize> = dialogue(&narrow)
            .iter()
            .map(|e| e.matches("\\N").count())
            .collect();
        assert!(shape.iter().all(|n| *n == shape[0] && *n >= 1), "{shape:?}");
        assert!(!narrow.contains('\u{E0B0}'));
    }

    #[test]
    fn loudness_emphasis_survives_fitting() {
        // A Chinese sentence is one whitespace word, so one level. A break
        // counted as a word boundary would make that two, and the effect
        // would silently switch off.
        let doc = to_ass_emphasised(
            &[cue(1.0, 4.0, &[LONG_ZH])],
            &style(),
            VERTICAL,
            &[vec![1.0]],
            0.5,
        );
        let event = dialogue(&doc)[0];
        assert!(event.contains("\\fs"), "emphasis was dropped: {event}");
        assert!(event.contains("\\N"), "no break: {event}");
    }

    #[test]
    fn a_bilingual_translation_is_fitted_under_its_own_size() {
        let top = [cue(
            1.0,
            4.0,
            &["Today we introduce a free tool that makes subtitles"],
        )];
        let bottom = [cue(1.0, 4.0, &[LONG_ZH])];
        let doc = to_ass_bilingual(&top, &bottom, &style(), VERTICAL, 0.7, 1.0);
        // One separator between the languages, and more inside the Chinese.
        assert!(
            dialogue(&doc)[0].matches("\\N").count() >= 2,
            "{}",
            dialogue(&doc)[0]
        );
        assert!(!doc.contains('\u{E0B0}'));
    }
}
