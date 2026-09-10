//! What a paid job costs the user, in credits.
//!
//! One rule decides every number here: **the user is quoted a price before
//! the job runs, and charged exactly that.** Not a range, not a
//! reconciliation afterwards, and never a token count. Someone subtitling a
//! holiday video should not have to reason about tokenisers to find out
//! what a button costs.
//!
//! That promise costs something: the quote has to be right or generous,
//! because we absorb the difference. So every estimate here rounds *against
//! us* — up on what we will spend, up again when converting to credits.
//! The margin is wide enough to pay for that, and being wrong in the user's
//! favour is the only direction that does not produce a complaint.
//!
//! The pricing rule itself lives in exactly one place ([`COST_SHARE`]) so
//! it can be changed without hunting through call sites.

use serde::{Deserialize, Serialize};

/// Vendor cost as a fraction of what we charge.
///
/// 0.30 means a job that costs us $0.30 is sold for $1.00 — a 70% gross
/// margin. Raising this thins the margin; lowering it widens it. Nothing
/// else in the codebase encodes the markup.
pub const COST_SHARE: f64 = 0.30;

/// What one credit is worth, in USD.
///
/// Set by the pack price: **$5 buys 1,000 credits**, so a credit is half a
/// cent. Keeping the denomination on a round pack price is what lets the
/// interface print a dollar figure beside every quote without a conversion
/// table — a reader can check the arithmetic in their head, which is worth
/// more than a tidier per-credit number.
///
/// Changing this changes the granularity, not the margin: the price in
/// dollars comes from [`COST_SHARE`], and credits are only the unit it is
/// quoted in. A larger credit does mean rounding up bites harder on tiny
/// jobs, always in our favour.
pub const CREDIT_USD: f64 = 0.005;

/// What a pack costs and what it contains, for the interface to state
/// plainly. Derived from [`CREDIT_USD`] so the two cannot drift.
pub const PACK_CREDITS: u32 = 1_000;

/// The pack price in USD.
pub fn pack_usd() -> f64 {
    f64::from(PACK_CREDITS) * CREDIT_USD
}

/// Vendor token rates, in USD per million tokens.
///
/// # These are placeholders
///
/// They must be confirmed against the provider's current price list before
/// anyone is charged, and re-confirmed when the model changes — a rate that
/// has drifted silently turns a 70% margin negative without any symptom a
/// test would catch. Keep them here rather than in the backend so the quote
/// the user sees and the cost we model can never disagree.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rates {
    pub input_per_m: f64,
    pub output_per_m: f64,
}

impl Rates {
    /// DeepSeek chat, standard (non-cached) rates. **Placeholder — confirm.**
    pub const DEEPSEEK_CHAT: Self = Self {
        input_per_m: 0.27,
        output_per_m: 1.10,
    };

    /// USD for a job of this shape.
    pub fn cost_usd(&self, input_tokens: u64, output_tokens: u64) -> f64 {
        (input_tokens as f64 / 1e6) * self.input_per_m
            + (output_tokens as f64 / 1e6) * self.output_per_m
    }
}

/// A quote, ready to show and to charge.
///
/// `credits` is the only field the interface should ever display. The rest
/// exists so the numbers can be audited against real invoices later, and so
/// a support conversation can answer "why did that cost 6?" without anyone
/// re-deriving it by hand.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Quote {
    /// What the user pays. Always at least 1 for a job that runs at all.
    pub credits: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// What we expect to pay the vendor, in USD.
    pub cost_usd: f64,
    /// What the credits are worth, in USD.
    pub price_usd: f64,
}

impl Quote {
    /// Realised gross margin, as a fraction. Sanity-checkable in tests.
    pub fn margin(&self) -> f64 {
        if self.price_usd <= 0.0 {
            return 0.0;
        }
        (self.price_usd - self.cost_usd) / self.price_usd
    }
}

/// Price a job of a known token shape.
///
/// Rounds the credit count **up**: a job may cost a fraction of a credit
/// more than it should, never less, and a job that does any work at all
/// costs at least one credit. Charging zero for real vendor spend is the
/// one outcome with no ceiling on how much it can lose.
pub fn quote(input_tokens: u64, output_tokens: u64, rates: Rates) -> Quote {
    let cost_usd = rates.cost_usd(input_tokens, output_tokens);
    let price_usd = cost_usd / COST_SHARE;
    let credits = if input_tokens == 0 && output_tokens == 0 {
        0
    } else {
        ((price_usd / CREDIT_USD).ceil() as u32).max(1)
    };
    Quote {
        credits,
        input_tokens,
        output_tokens,
        cost_usd,
        // The user pays whole credits, so the realised price is the rounded
        // one -- reporting the unrounded figure would understate margin.
        price_usd: f64::from(credits) * CREDIT_USD,
    }
}

/// Vendor cost for hosted speech recognition, in USD per minute of audio.
///
/// Priced per minute rather than per token because that is how every
/// hosted recogniser bills, and pretending otherwise would put a
/// conversion nobody can check between the meter and the invoice.
///
/// # Placeholder
///
/// Confirm against the provider before charging anyone. See [`Rates`].
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AudioRates {
    pub per_minute_usd: f64,
}

impl AudioRates {
    /// A hosted Whisper-class endpoint. **Placeholder — confirm.**
    pub const HOSTED_WHISPER: Self = Self {
        per_minute_usd: 0.006,
    };
}

/// What transcribing `seconds` of audio costs, in credits.
///
/// Billed on the trimmed span, not the source file: a 20-second clip taken
/// from an hour-long recording is charged as 20 seconds, because that is
/// all that is sent.
pub fn quote_audio(seconds: f64, rates: AudioRates) -> Quote {
    // NaN and negatives both land here, which is the point: a duration we
    // cannot reason about is billed as nothing rather than as something.
    if !matches!(seconds.partial_cmp(&0.0), Some(std::cmp::Ordering::Greater)) {
        return Quote {
            credits: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            price_usd: 0.0,
        };
    }
    // Round the billed duration up to the second. Sub-second slivers are
    // not worth a fraction in a ledger, and rounding down would bill less
    // audio than we send.
    let billed = seconds.ceil();
    let cost_usd = billed / 60.0 * rates.per_minute_usd;
    let price_usd = cost_usd / COST_SHARE;
    let credits = ((price_usd / CREDIT_USD).ceil() as u32).max(1);
    Quote {
        credits,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd,
        price_usd: f64::from(credits) * CREDIT_USD,
    }
}

/// Approximate token count for `text`.
///
/// A real tokeniser would be exact, but shipping one means shipping its
/// vocabulary — megabytes into a wasm bundle, per model — to answer a
/// question whose answer is then rounded up to the nearest credit anyway.
/// So this uses the provider's own published rule of thumb: roughly 0.3
/// tokens per English character and 0.6 per Chinese character.
///
/// # How wrong it is, measured
///
/// Checked against `cl100k_base`, which is a *different* vocabulary and
/// therefore an imperfect yardstick — but the only one available here:
///
/// | text | real | ours | ratio |
/// |---|---|---|---|
/// | the system prompt | 234 | 342 | 1.46× |
/// | an English subtitle | 12 | 16 | 1.33× |
/// | French | 14 | 15 | 1.07× |
/// | Russian | 20 | 17 | 0.85× |
/// | digits and punctuation | 21 | 13 | 0.62× |
/// | Chinese | 16 | 8 | 0.50× |
///
/// So it **under-counts**, worst on CJK and on digit-heavy lines — the
/// opposite of what an earlier version of this comment claimed. Chinese is
/// also the app's headline translation target, so this is not a corner
/// case.
///
/// Two things make that survivable rather than alarming, and both are worth
/// knowing rather than assuming:
///
/// - Against DeepSeek's own tokeniser the CJK row is probably much closer,
///   because 0.6/char is *their* published figure and their vocabulary is
///   trained heavily on Chinese. `cl100k` is the pessimistic reading.
/// - The margin absorbs it. If the real count is `k` times ours, the
///   realised margin is `1 - 0.30k`: 55% at 1.5×, 40% at 2×, and it only
///   reaches zero at 3.33×. See `undercounting_eats_margin_before_it_eats_money`.
///
/// The fix, when it matters, is to record actual usage from the API
/// response and calibrate — not to bolt a fudge factor onto a guess.
pub fn estimate_tokens(text: &str) -> u64 {
    let mut total: f64 = 0.0;
    for c in text.chars() {
        total += if is_wide_script(c) {
            0.6
        } else if c.is_ascii() {
            0.3
        } else {
            // Accented Latin, Cyrillic, Arabic and the like tokenise worse
            // than ASCII in a byte-pair vocabulary trained mostly on English.
            0.5
        };
    }
    total.ceil() as u64
}

/// Scripts written without spaces, which tokenise per character.
fn is_wide_script(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{30FF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{4E00}'..='\u{9FFF}'
        | '\u{AC00}'..='\u{D7AF}'
        | '\u{F900}'..='\u{FAFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn margin_is_seventy_percent() {
        let q = quote(100_000, 50_000, Rates::DEEPSEEK_CHAT);
        // Rounding up to whole credits can only help us, never hurt.
        assert!(
            q.margin() >= 0.70,
            "margin fell to {:.4} -- the pricing rule is not holding",
            q.margin()
        );
        assert!(q.margin() < 0.75, "rounding should not inflate it much");
    }

    #[test]
    fn a_job_that_runs_costs_at_least_one_credit() {
        let q = quote(1, 1, Rates::DEEPSEEK_CHAT);
        assert_eq!(q.credits, 1, "never charge zero for real vendor spend");
    }

    #[test]
    fn a_pack_is_five_dollars_for_a_thousand_credits() {
        // The interface prints this as a sentence. If the constant moves
        // without the copy moving with it, this is what catches it.
        assert_eq!(PACK_CREDITS, 1_000);
        assert!(
            (pack_usd() - 5.0).abs() < 1e-9,
            "a pack came to ${:.4}",
            pack_usd()
        );
    }

    #[test]
    fn audio_is_billed_by_the_minute_and_holds_the_margin() {
        for seconds in [1.0, 30.0, 90.0, 600.0, 3600.0] {
            let q = quote_audio(seconds, AudioRates::HOSTED_WHISPER);
            assert!(
                q.margin() >= 0.70,
                "{seconds}s transcribed at {:.1}% margin",
                q.margin() * 100.0
            );
        }
        assert_eq!(quote_audio(0.0, AudioRates::HOSTED_WHISPER).credits, 0);
        // Longer audio never costs less.
        let short = quote_audio(60.0, AudioRates::HOSTED_WHISPER);
        let long = quote_audio(600.0, AudioRates::HOSTED_WHISPER);
        assert!(long.credits > short.credits);
    }

    #[test]
    fn nothing_costs_nothing() {
        assert_eq!(quote(0, 0, Rates::DEEPSEEK_CHAT).credits, 0);
    }

    #[test]
    fn credits_never_round_down() {
        for input in [1_u64, 7, 999, 12_345, 987_654] {
            let q = quote(input, input, Rates::DEEPSEEK_CHAT);
            let raw = q.cost_usd / COST_SHARE / CREDIT_USD;
            assert!(
                f64::from(q.credits) >= raw,
                "{input} tokens rounded down: {} < {raw}",
                q.credits
            );
        }
    }

    #[test]
    fn undercounting_eats_margin_before_it_eats_money() {
        // The estimator is a heuristic and it under-counts (see its docs).
        // This pins how much of that the pricing rule can swallow, so the
        // slack is a measured quantity rather than a hope.
        let q = quote(10_000, 10_000, Rates::DEEPSEEK_CHAT);
        for (k, floor) in [(1.5, 0.50), (2.0, 0.35), (3.0, 0.05)] {
            let actual_cost = q.cost_usd * k;
            let realised = (q.price_usd - actual_cost) / q.price_usd;
            assert!(
                realised > floor,
                "at {k}x under-count the margin falls to {:.0}%",
                realised * 100.0
            );
        }
        // And the point where it turns into a loss.
        let breakeven = 1.0 / COST_SHARE;
        assert!(
            (breakeven - 3.333).abs() < 0.01,
            "break-even moved to {breakeven:.2}x -- the docs quote 3.33x"
        );
    }

    #[test]
    fn chinese_costs_more_tokens_per_character_than_english() {
        // The pricing has to know this: a Chinese target is not the same
        // spend as a French one for the same subtitle.
        assert!(estimate_tokens("这是斯巴达") > estimate_tokens("Sparta"));
    }

    #[test]
    fn token_estimate_is_not_wildly_off_for_english() {
        // ~4 characters per token is the widely-quoted figure for English.
        let text = "The quick brown fox jumps over the lazy dog every single morning.";
        let estimated = estimate_tokens(text) as f64;
        let rough = text.len() as f64 / 4.0;
        assert!(
            estimated >= rough * 0.9 && estimated <= rough * 1.6,
            "estimated {estimated} against a rough {rough}"
        );
    }

    #[test]
    fn raising_the_cost_share_thins_the_margin() {
        // Guards the one constant the business cares about: if this stops
        // being the only lever, the test stops passing.
        let q = quote(10_000, 10_000, Rates::DEEPSEEK_CHAT);
        assert!((q.margin() - (1.0 - COST_SHARE)).abs() < 0.05);
    }
}
