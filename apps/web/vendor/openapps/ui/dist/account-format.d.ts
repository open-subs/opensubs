/** Proper nouns: the same in every language. */
export declare const LABELS: Record<string, string>;
/** What a kind of sign-in is called. */
export declare function label(namespace: string): string;
export declare function num(value: number): string;
/** Parts per million as a percentage: 750000 → "75%". */
export declare function percent(ppm: number): string;
/** A unix time as a date in the reader's own locale. */
export declare function day(seconds: number): string;
/**
 * A unix time as a date and time where the reader is. A month's credits
 * lapse at 00:00 UTC, which is the evening before in Honolulu and nine in
 * the morning in Seoul, so the date alone would be wrong for half the world.
 */
export declare function moment(seconds: number): string;
/** The same instant in UTC, for the tooltip. */
export declare function utc(seconds: number): string;
/** Middle-truncate a long identifier for display. */
export declare function middle(value: string, head?: number, tail?: number): string;
//# sourceMappingURL=account-format.d.ts.map