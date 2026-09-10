// What a job costs, before it runs.
//
// One promise shapes this file: **the user sees one number before they
// commit, and that is what they pay.** No token counts, no "up to", no
// reconciliation afterwards. Someone subtitling a holiday video should not
// have to reason about tokenisers to find out what a button costs.
//
// The price is computed by the engine (`subs_credits`) compiled to wasm,
// and the gateway computes the charge from the same crate compiled native —
// so the figure shown here and the figure taken there agree by
// construction. This module only *displays*; the account, the balance and
// the charging live in `account.ts`, against the real backend.

import { quoteTranslation, quoteTranscription, creditPricing } from "../wasm-gen/subs_engine";

export interface Quote {
  /** The only figure the interface should ever show. */
  credits: number;
  /** Present for support and auditing. Never rendered. */
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  price_usd: number;
}

/**
 * What translating these lines on our backend will cost.
 *
 * Synchronous and offline: the estimate comes from the wasm engine, so the
 * price is on screen the instant a language is picked, with no round trip
 * and no account needed to see it. Somebody comparing us against a rival
 * can read the price without signing up.
 */
export function quoteForTranslation(lines: string[], target: string): Quote {
  return JSON.parse(quoteTranslation(JSON.stringify(lines), target)) as Quote;
}

/**
 * What transcribing this much audio on our backend will cost.
 *
 * Priced on the trimmed span, because that is all that gets uploaded — a
 * twenty-second excerpt of an hour-long recording is charged as twenty
 * seconds.
 */
export function quoteForTranscription(seconds: number): Quote {
  return JSON.parse(quoteTranscription(seconds)) as Quote;
}

interface Pricing {
  credit_usd: number;
  pack_credits: number;
  pack_usd: number;
}

/**
 * The credit denomination, read from the engine rather than duplicated.
 *
 * Resolved on first use, not at import: the wasm module is initialised by
 * `load()` during mount, and a module-level call runs before that — which
 * throws deep inside the bindings with a message about a stack pointer
 * that names nothing a reader could act on.
 */
let pricing: Pricing | null = null;

export function PRICING_OF(): Pricing {
  pricing ??= JSON.parse(creditPricing()) as Pricing;
  return pricing;
}

/**
 * A credit count with its dollar value: `8 credits · $0.04`.
 *
 * Both halves, always. Credits alone are a currency nobody has an instinct
 * for — "26 credits" could be pennies or a month's subscription, and a
 * reader should not have to go and find the conversion to know which. The
 * dollar figure is what makes the price legible on first sight; the credits
 * are what actually gets debited.
 */
export function priceLabel(credits: number): string {
  return `${creditWord(credits)} · ${usd(credits * PRICING_OF().credit_usd)}`;
}

/** "1 credit", "8 credits". */
export function creditWord(credits: number): string {
  return `${credits} ${credits === 1 ? "credit" : "credits"}`;
}

/**
 * A dollar figure at a resolution worth reading.
 *
 * Sub-cent amounts get three decimals rather than rounding to `$0.00`,
 * which reads as free and is the one thing a price must never do.
 */
export function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
