// An error a person reads.
//
// Thrown where the failure is understood, shown where the interface
// language is known. The message stays English -- the key it is looked up
// under, the same convention as `t()` -- so a log or a test reads the same
// in every locale, and the page translates it at the one place it is
// displayed. A plain `Error` with an English sentence in it reached the
// screen as English in every language the interface offers.

export type SayParams = Record<string, string | number>;

export class Say extends Error {
  constructor(
    /** The English sentence, with `{name}` placeholders: a catalogue key. */
    readonly key: string,
    readonly params: SayParams = {},
  ) {
    super(key.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole)));
    this.name = "Say";
  }
}
