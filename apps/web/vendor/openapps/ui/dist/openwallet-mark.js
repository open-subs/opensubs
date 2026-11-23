/**
 * OnWallet's mark, wordmark and the line under its button.
 *
 * Its own module rather than a part of `provider-marks.ts`: those are
 * third-party trademarks the sign-in buttons need, while this is one of our
 * own products, drawn from our brand kit — and `<openapps-account>`, which
 * uses only this, should not carry every other mark in its bundle to get it.
 */
import { css, html, svg } from "lit";
/**
 * OnWallet's tile, from our own brand kit rather than a third party's: the
 * white Lucide `wallet` glyph on accent slot 30 (amethyst), squircle radius
 * 22%. At this 16px size the glyph is drawn at 0.68× the tile and a heavier
 * stroke so it still reads — the geometry of the extension's own 16px icon.
 * A tile never carries the full stop; the wordmark beside it does.
 *
 * The fill reads `--ow-amethyst` (see {@link openwalletStyles}) and falls
 * back to its resolved value, `#8d66a0`.
 */
export const openwalletMark = svg `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="5.28" fill="#8d66a0" style="fill: var(--ow-amethyst, #8d66a0)"/><g transform="translate(3.84 3.84) scale(.68)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></g></svg>`;
/**
 * "OnWallet." set as its wordmark: `On` muted, the word at full
 * strength, the full stop in the product's accent. The full stop is part of
 * the name (brand kit), so it is drawn wherever the name is set in type.
 */
export const openwalletWordmark = html `<span class="ow-word"
  ><span class="ow-open">On</span>Wallet<span class="ow-dot">.</span></span
>`;
/**
 * OnWallet is not out yet (November 2026). Until it is, every sign-in box
 * shows its button greyed out with "Coming soon", whatever the server offers,
 * and the account card does not ask anyone to connect it. Set this to false
 * when OnWallet ships, and the button signs in again.
 */
export const ONWALLET_SOON = true;
/** The line under the greyed-out button. */
export const ONWALLET_SOON_HINT = "Coming soon";
/** The line under an OnWallet button: approval never happens in the page. */
export const OPENWALLET_HINT = "Approve in your OnWallet browser extension";
/**
 * Styles for the OnWallet mark, wordmark and hint. Amethyst is
 * `color-mix(in oklab, var(--red) 29%, var(--iris))` (ACCENT-SLOTS.md, slot
 * 30). The palette's own values stand in where a host has not linked the
 * tokens, and a browser without `color-mix` keeps the resolved hex.
 */
export const openwalletStyles = css `
  :host {
    --ow-amethyst: #8d66a0;
  }
  @supports (color: color-mix(in oklab, red 50%, blue)) {
    :host {
      --ow-amethyst: color-mix(in oklab, var(--red, #ff4d4d) 29%, var(--iris, #5962b9));
    }
  }
  .ow-open {
    color: var(--text-muted, var(--fb-muted));
  }
  .ow-dot {
    color: var(--ow-amethyst);
  }
  .ow-soon svg {
    filter: grayscale(1);
  }
  .ow-soon .ow-dot {
    color: inherit;
  }
  .ow-hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--text-muted, var(--fb-muted));
  }
`;
//# sourceMappingURL=openwallet-mark.js.map