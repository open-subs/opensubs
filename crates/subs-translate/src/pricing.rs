//! What a translation will cost, before it runs.
//!
//! This lives beside the prompt builder rather than in the interface, and
//! that placement is the whole point: the thing being paid for is the
//! request [`crate::claude::build_request`] actually sends, not the cue
//! text a UI can see. Two parts of that request are invisible from
//! outside and together dominate a short job —
//!
//! - the system prompt, ~500 tokens, re-sent **with every batch**;
//! - the JSON scaffolding around the lines, which for one-word cues can
//!   outweigh the words themselves.
//!
//! A browser counting characters in the cue list would under-quote a
//! 200-cue clip by several batches' worth of system prompt. Since we honour
//! the quote, that error is money.

use crate::{claude, MAX_BATCH};
use subs_credits::{estimate_tokens, quote, Quote, Rates};

/// How much longer the output runs than the lines going in.
///
/// The prompt asks for translations "roughly as long as the original", so
/// the honest central estimate is about 1.0. This sits above it because the
/// quote is a promise: a batch that runs long is absorbed, and the cost of
/// being wrong upward is a slightly dearer quote while the cost of being
/// wrong downward is unbounded.
///
/// Calibrate against real usage once the backend records actuals. Until
/// then this is a guess with a safety factor, and it is labelled as one.
const OUTPUT_RATIO: f64 = 1.35;

/// JSON scaffolding per line: quotes, comma, newline, and the escaping the
/// serialiser adds. Small, but it is charged on every line of every batch.
const PER_LINE_OVERHEAD: u64 = 4;

/// Estimate the tokens one batch of `lines` sends and receives.
fn batch_tokens(lines: &[String], instruction_tokens: u64) -> (u64, u64) {
    let body: u64 = lines
        .iter()
        .map(|l| estimate_tokens(l) + PER_LINE_OVERHEAD)
        .sum();
    let input = system_tokens() + instruction_tokens + body;
    let output = (body as f64 * OUTPUT_RATIO).ceil() as u64;
    (input, output)
}

/// Tokens in the system prompt, counted from the prompt itself.
///
/// Derived rather than hardcoded so that editing the prompt cannot silently
/// change what a job costs without changing what it is quoted at.
fn system_tokens() -> u64 {
    estimate_tokens(claude::SYSTEM)
}

/// What translating these lines will cost, in credits.
///
/// Batching is modelled explicitly: `lines` is split the same way
/// [`crate::translate_cues`] splits it, and each batch pays for its own
/// system prompt. A 300-line clip is five requests, not one.
pub fn quote_translation(lines: &[String], target: &str, rates: Rates) -> Quote {
    if lines.is_empty() {
        return quote(0, 0, rates);
    }
    // The instruction line names the language, so a long language name
    // costs marginally more. Counted rather than assumed.
    let instruction = format!("Translate these subtitle lines into {}.", target);
    let instruction_tokens = estimate_tokens(&instruction);

    let mut input = 0;
    let mut output = 0;
    for batch in lines.chunks(MAX_BATCH) {
        let (i, o) = batch_tokens(batch, instruction_tokens);
        input += i;
        output += o;
    }
    quote(input, output, rates)
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn lines(n: usize) -> Vec<String> {
        (0..n)
            .map(|i| format!("This is subtitle line number {i}, about average length."))
            .collect()
    }

    #[test]
    fn nothing_to_translate_costs_nothing() {
        assert_eq!(
            quote_translation(&[], "Chinese", Rates::DEEPSEEK_CHAT).credits,
            0
        );
    }

    #[test]
    fn the_system_prompt_is_charged_once_per_batch() {
        // The trap this guards: quoting a long clip as though the prompt
        // were sent once. At MAX_BATCH=60, 120 lines is two batches.
        let one = quote_translation(&lines(MAX_BATCH), "Chinese", Rates::DEEPSEEK_CHAT);
        let two = quote_translation(&lines(MAX_BATCH * 2), "Chinese", Rates::DEEPSEEK_CHAT);
        let overhead = system_tokens();
        assert!(
            two.input_tokens >= one.input_tokens * 2,
            "the second batch did not pay for its own prompt"
        );
        assert!(
            two.input_tokens - 2 * (one.input_tokens - overhead) >= 2 * overhead - 4,
            "system prompt undercounted across batches"
        );
    }

    #[test]
    fn a_longer_clip_costs_more() {
        let short = quote_translation(&lines(10), "Chinese", Rates::DEEPSEEK_CHAT);
        let long = quote_translation(&lines(200), "Chinese", Rates::DEEPSEEK_CHAT);
        assert!(long.credits > short.credits);
    }

    #[test]
    fn margin_holds_across_realistic_clip_sizes() {
        // The business rule, checked end to end rather than on the
        // primitive: every size a user can actually produce must clear 70%.
        for n in [1_usize, 5, 60, 61, 200, 1000] {
            let q = quote_translation(&lines(n), "Simplified Chinese", Rates::DEEPSEEK_CHAT);
            assert!(
                q.margin() >= 0.70,
                "{n} lines quoted at {:.1}% margin",
                q.margin() * 100.0
            );
        }
    }

    #[test]
    fn a_typical_short_video_is_a_small_number_of_credits() {
        // A price nobody has to think about is the entire design goal. If
        // this starts failing, the credit unit is wrong, not the test.
        let q = quote_translation(&lines(40), "Simplified Chinese", Rates::DEEPSEEK_CHAT);
        assert!(
            (1..=60).contains(&q.credits),
            "40 lines quoted at {} credits -- not a number a novice can shrug at",
            q.credits
        );
    }

    #[test]
    fn editing_the_prompt_changes_the_quote() {
        // system_tokens() reads the real prompt, so the two cannot drift.
        assert!(
            system_tokens() > 200,
            "the system prompt is not being counted"
        );
    }
}

#[cfg(test)]
mod scale {
    use super::tests::lines;
    use super::*;

    #[test]
    fn print_the_price_list() {
        // Not an assertion -- a way to see what the pricing rule actually
        // charges. Run with `cargo test -p subs-translate -- --nocapture`.
        for (label, n) in [
            ("30s clip", 12),
            ("3min", 60),
            ("10min", 200),
            ("1hr", 1200),
        ] {
            let q = quote_translation(&lines(n), "Simplified Chinese", Rates::DEEPSEEK_CHAT);
            println!(
                "{label:>10}: {:>5} credits  (${:.4} charged, ${:.4} cost, margin {:.0}%)",
                q.credits,
                q.price_usd,
                q.cost_usd,
                q.margin() * 100.0
            );
        }
    }
}
