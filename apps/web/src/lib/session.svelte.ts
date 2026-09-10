// Who is signed in, and what they have to spend.
//
// This is the one piece of the app's state that two separately mounted
// components need. The page has the app in it *and* a navbar above it, and
// the navbar is static HTML so the marketing copy around it is in the
// document rather than assembled by script -- so the account controls in
// that navbar are their own small mount, not part of `App`.
//
// Two mounts cannot share a `$state` declared inside a component, and a
// plain module-level `let` would not be reactive. A rune in a `.svelte.ts`
// module is both: one object, reactive from either side, with no store
// ceremony and no second copy of the truth to drift.

/** The signed-in session, as the whole page sees it. */
export const session = $state({
  /**
   * Whether someone is signed in.
   *
   * A getter on the SDK client would not be reactive -- the session
   * changes inside the SDK, not through a rune -- so `onAccountChange` is
   * what writes this. Without it, signing in through `<openapps-login>`
   * updates that element and nothing else on the page.
   */
  signedIn: false,
  /**
   * Credits, as the server last reported them.
   *
   * Never decremented locally. The same account can be spent from other
   * surfaces, so a number this tab computed is a guess.
   */
  balance: 0,
});
