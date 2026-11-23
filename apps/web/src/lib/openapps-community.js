// @ts-nocheck -- vendored verbatim into products whose type checkers differ;
// the source of truth is this file, tested by openapps-community.test.mjs.
/**
 * <openapps-community>: the product's Telegram topic and X account, as two
 * outlined buttons that are hard to miss and still calm beside the one green
 * primary action a screen has.
 *
 * One file, no dependencies, no build step, nothing sent anywhere: two links.
 * Copy it verbatim into a product; this copy is the source.
 *
 * USE
 *
 *   import { configureCommunity } from "./openapps-community.js";
 *   configureCommunity({
 *     product: "OpenPixels",
 *     telegramUrl: "https://t.me/openappsnetwork/12",
 *     xUrl: "https://x.com/OpenPixelsApp",
 *     xHandle: "@OpenPixelsApp",
 *   });
 *
 *   <openapps-community></openapps-community>                    the pair
 *   <openapps-community variant="header"></openapps-community>   app header: short
 *                                labels, icon-only buttons below 640px wide
 *   <openapps-community variant="success"></openapps-community>  after a finished
 *                                task: one line inviting a follow, then the pair
 *
 * `compact` (header variant only) draws the pair as icons at any width, each
 * keeping its accessible name ("OpenPixels on Telegram"). The header's fit
 * script (openapps-header-fit.js) sets and clears it as the first step of
 * making row one fit; a page may also set it by hand. CSS only: toggling it
 * does not redraw the element.
 *
 * `only="telegram"` (or `only="x"`) draws one button: the Telegram button at
 * an error point, where following on X is beside the point.
 *
 * Attributes `telegram-url`, `x-url`, `x-handle` and `product` override the
 * config for one element, for a page that cannot run a module first.
 *
 * LOOK
 *
 * The design system's secondary button: a hairline `--border-strong` border,
 * `--text-strong` label, transparent fill; on hover the border and label take
 * `--text-link-hover` (the suite green); `--border-focus` ring on keyboard
 * focus. The Telegram and X marks are brand glyphs (Simple Icons, CC0) —
 * Lucide has neither — drawn in `currentColor` like any Lucide glyph. Never
 * a brand colour: one accent per app.
 *
 * LANGUAGE
 *
 * Follows `<html lang>` and redraws when it changes; same locales as
 * <openapps-support>.
 */

export const DEFAULT_TELEGRAM_URL = "https://t.me/openappsnetwork";

const config = { product: "", telegramUrl: "", xUrl: "", xHandle: "" };
const live = new Set();

/** Set once at start-up. Later calls merge. */
export function configureCommunity(options = {}) {
  Object.assign(config, options);
  for (const el of live) el.render();
}

function linksFor(el) {
  const attr = (n) => (el?.getAttribute?.(n) ?? "").trim();
  const product = attr("product") || String(config.product || "").trim();
  const telegramUrl = attr("telegram-url") || String(config.telegramUrl || "").trim() || DEFAULT_TELEGRAM_URL;
  const xUrl = attr("x-url") || String(config.xUrl || "").trim();
  // An element given its own X link takes only its own handle (or the one in
  // that link), never the configured product's.
  let xHandle = attr("x-handle") || (attr("x-url") ? "" : String(config.xHandle || "").trim());
  if (xUrl && !xHandle) {
    const last = xUrl.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
    xHandle = last && !/^(x|twitter)\.com$/i.test(last) ? last : "";
  }
  if (xHandle && !xHandle.startsWith("@")) xHandle = `@${xHandle}`;
  return { product, telegramUrl, xUrl, xHandle: xUrl ? xHandle : "" };
}

/** `{ product, telegramUrl, xUrl, xHandle }` from the config. */
export function communityLinks() {
  return linksFor(null);
}

// ---------------------------------------------------------------- language

export const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt", "fr", "ru"];

export function matchLocale(raw) {
  const tag = String(raw || "en").trim();
  const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans";
  const base = lower.split("-")[0];
  return LOCALES.find((l) => l === base) || "en";
}

const S_ASK = "Ask us on Telegram";
const S_FOLLOW = "Follow {handle} on X";
const S_FOLLOW_X = "Follow us on X";
const S_TG_SHORT = "Telegram";
const S_X_SHORT = "Follow on X";
const S_SUCCESS = "Enjoying {product}? Follow along for updates, or tell us what to improve.";
const S_SUCCESS_PLAIN = "Enjoying it? Follow along for updates, or tell us what to improve.";
const S_TG_LABEL = "{product} on Telegram";
const S_X_LABEL = "{product} on X";

/** Every English string the element can show — the keys each locale must cover. */
export const STRINGS = [S_ASK, S_FOLLOW, S_FOLLOW_X, S_TG_SHORT, S_X_SHORT, S_SUCCESS, S_SUCCESS_PLAIN, S_TG_LABEL, S_X_LABEL];

export const CATALOGUE = {
  "zh-Hans": {
    [S_ASK]: "到 Telegram 上问我们",
    [S_FOLLOW]: "在 X 上关注 {handle}",
    [S_FOLLOW_X]: "在 X 上关注我们",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "在 X 上关注",
    [S_SUCCESS]: "喜欢 {product} 吗？关注我们获取更新，或告诉我们哪里可以改进。",
    [S_SUCCESS_PLAIN]: "喜欢吗？关注我们获取更新，或告诉我们哪里可以改进。",
    [S_TG_LABEL]: "{product} 的 Telegram",
    [S_X_LABEL]: "{product} 的 X",
  },
  "zh-Hant": {
    [S_ASK]: "到 Telegram 上問我們",
    [S_FOLLOW]: "在 X 上追蹤 {handle}",
    [S_FOLLOW_X]: "在 X 上關注我們",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "在 X 上關注",
    [S_SUCCESS]: "喜歡 {product} 嗎？關注我們取得更新，或告訴我們哪裡可以改進。",
    [S_SUCCESS_PLAIN]: "喜歡嗎？關注我們取得更新，或告訴我們哪裡可以改進。",
    [S_TG_LABEL]: "{product} 的 Telegram",
    [S_X_LABEL]: "{product} 的 X",
  },
  ja: {
    [S_ASK]: "Telegramで質問する",
    [S_FOLLOW]: "X で {handle} をフォロー",
    [S_FOLLOW_X]: "Xでフォロー",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "Xでフォロー",
    [S_SUCCESS]: "{product} を気に入っていただけましたか？最新情報をフォローするか、改善点を教えてください。",
    [S_SUCCESS_PLAIN]: "気に入っていただけましたか？最新情報をフォローするか、改善点を教えてください。",
    [S_TG_LABEL]: "Telegramの{product}",
    [S_X_LABEL]: "Xの{product}",
  },
  ko: {
    [S_ASK]: "텔레그램으로 문의하기",
    [S_FOLLOW]: "X에서 {handle} 팔로우",
    [S_FOLLOW_X]: "X에서 팔로우하기",
    [S_TG_SHORT]: "텔레그램",
    [S_X_SHORT]: "X에서 팔로우",
    [S_SUCCESS]: "{product}이(가) 마음에 드셨나요? 소식을 받아 보시거나 개선할 점을 알려 주세요.",
    [S_SUCCESS_PLAIN]: "마음에 드셨나요? 소식을 받아 보시거나 개선할 점을 알려 주세요.",
    [S_TG_LABEL]: "텔레그램의 {product}",
    [S_X_LABEL]: "X의 {product}",
  },
  de: {
    [S_ASK]: "Fragen Sie uns auf Telegram",
    [S_FOLLOW]: "{handle} auf X folgen",
    [S_FOLLOW_X]: "Folgen Sie uns auf X",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "Auf X folgen",
    [S_SUCCESS]: "Gefällt Ihnen {product}? Folgen Sie uns für Neuigkeiten oder sagen Sie uns, was besser werden soll.",
    [S_SUCCESS_PLAIN]: "Gefällt es Ihnen? Folgen Sie uns für Neuigkeiten oder sagen Sie uns, was besser werden soll.",
    [S_TG_LABEL]: "{product} auf Telegram",
    [S_X_LABEL]: "{product} auf X",
  },
  es: {
    [S_ASK]: "Pregúntanos en Telegram",
    [S_FOLLOW]: "Sigue a {handle} en X",
    [S_FOLLOW_X]: "Síguenos en X",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "Seguir en X",
    [S_SUCCESS]: "¿Te gusta {product}? Síguenos para enterarte de las novedades o dinos qué mejorar.",
    [S_SUCCESS_PLAIN]: "¿Te gusta? Síguenos para enterarte de las novedades o dinos qué mejorar.",
    [S_TG_LABEL]: "{product} en Telegram",
    [S_X_LABEL]: "{product} en X",
  },
  pt: {
    [S_ASK]: "Pergunte-nos no Telegram",
    [S_FOLLOW]: "Siga {handle} no X",
    [S_FOLLOW_X]: "Siga-nos no X",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "Seguir no X",
    [S_SUCCESS]: "Está gostando do {product}? Siga-nos para ver as novidades ou diga o que podemos melhorar.",
    [S_SUCCESS_PLAIN]: "Está gostando? Siga-nos para ver as novidades ou diga o que podemos melhorar.",
    [S_TG_LABEL]: "{product} no Telegram",
    [S_X_LABEL]: "{product} no X",
  },
  fr: {
    [S_ASK]: "Posez-nous la question sur Telegram",
    [S_FOLLOW]: "Suivre {handle} sur X",
    [S_FOLLOW_X]: "Suivez-nous sur X",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "Suivre sur X",
    [S_SUCCESS]: "Vous aimez {product} ? Suivez-nous pour les nouveautés ou dites-nous quoi améliorer.",
    [S_SUCCESS_PLAIN]: "Vous aimez ? Suivez-nous pour les nouveautés ou dites-nous quoi améliorer.",
    [S_TG_LABEL]: "{product} sur Telegram",
    [S_X_LABEL]: "{product} sur X",
  },
  ru: {
    [S_ASK]: "Спросите нас в Telegram",
    [S_FOLLOW]: "Подписаться на {handle} в X",
    [S_FOLLOW_X]: "Подписывайтесь на нас в X",
    [S_TG_SHORT]: "Telegram",
    [S_X_SHORT]: "Подписаться в X",
    [S_SUCCESS]: "Нравится {product}? Подпишитесь на новости или расскажите, что улучшить.",
    [S_SUCCESS_PLAIN]: "Нравится? Подпишитесь на новости или расскажите, что улучшить.",
    [S_TG_LABEL]: "{product} в Telegram",
    [S_X_LABEL]: "{product} в X",
  },
};

/** English text is the key; `{name}` is filled from `vars`. */
export function t(locale, text, vars) {
  let out = CATALOGUE[locale]?.[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

function pageLocale() {
  return matchLocale(typeof document === "undefined" ? "en" : document.documentElement.lang);
}

// ------------------------------------------------------------------ glyphs

const SVG = (d) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
export const GLYPH_TELEGRAM = SVG(
  "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
);
export const GLYPH_X = SVG(
  "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
);

// ------------------------------------------------------------------- style

const STYLE = `
:host { display: block; font: inherit; color: var(--text-body, CanvasText); }
:host([variant="header"]) { display: inline-block; }
:host([hidden]) { display: none !important; }
* { box-sizing: border-box; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: var(--control-h-md, 36px); padding: 0 14px;
  border: 1px solid var(--border-strong, color-mix(in srgb, CanvasText 30%, transparent));
  border-radius: var(--radius-md, 8px); background: transparent;
  color: var(--text-strong, CanvasText); text-decoration: none; white-space: nowrap;
  font: inherit; font-size: var(--text-sm, 14px); font-weight: 500; line-height: 1;
  transition: color .15s, border-color .15s, background-color .15s;
}
.btn svg { width: 16px; height: 16px; flex: none; }
.btn:hover {
  color: var(--text-link-hover, #00c896); border-color: currentColor; text-decoration: none;
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.btn:focus-visible { outline: 2px solid var(--border-focus, Highlight); outline-offset: 2px; }
:host([variant="header"]) .btn { min-height: var(--control-h-sm, 32px); padding: 0 10px; font-size: var(--text-xs, 13px); gap: 6px; }
:host([variant="header"]) .btn svg { width: 15px; height: 15px; }
@media (max-width: 639px) {
  :host([variant="header"]) .btn { width: var(--control-h-sm, 32px); padding: 0; }
  :host([variant="header"]) .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
:host([variant="header"][compact]) .btn { width: var(--control-h-sm, 32px); padding: 0; }
:host([variant="header"][compact]) .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.lede { margin: 0 0 10px; color: var(--text-muted, GrayText); font-size: var(--text-sm, 14px); line-height: 1.45; }
@media (pointer: coarse) { .btn { min-height: 44px; } :host([variant="header"]) .btn { min-height: 40px; } }
@media (pointer: coarse) and (max-width: 639px) { :host([variant="header"]) .btn { width: 40px; } }
@media (pointer: coarse) { :host([variant="header"][compact]) .btn { width: 40px; } }
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;

// ----------------------------------------------------------------- element

const BaseElement = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

export class OpenAppsCommunity extends BaseElement {
  static observedAttributes = ["variant", "only", "telegram-url", "x-url", "x-handle", "product"];
  #root = null;
  #langObserver = null;

  connectedCallback() {
    if (!this.#root) {
      this.#root = this.attachShadow({ mode: "open" });
    }
    live.add(this);
    if (!this.#langObserver && typeof MutationObserver !== "undefined") {
      this.#langObserver = new MutationObserver(() => this.render());
      this.#langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
    this.render();
  }

  disconnectedCallback() {
    live.delete(this);
    this.#langObserver?.disconnect();
    this.#langObserver = null;
  }

  attributeChangedCallback() {
    if (this.#root) this.render();
  }

  render() {
    if (!this.#root) return;
    const L = pageLocale();
    const variant = this.getAttribute("variant") || "buttons";
    const { product, telegramUrl, xUrl, xHandle } = linksFor(this);
    this.#root.textContent = "";
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.#root.appendChild(style);

    if (variant === "success") {
      const lede = document.createElement("p");
      lede.className = "lede";
      lede.setAttribute("part", "lede");
      lede.textContent = product ? t(L, S_SUCCESS, { product }) : t(L, S_SUCCESS_PLAIN);
      this.#root.appendChild(lede);
    }

    const header = variant === "header";
    const only = (this.getAttribute("only") || "").toLowerCase();
    const row = document.createElement("div");
    row.className = "row";
    row.setAttribute("part", "row");
    if (only !== "x") row.appendChild(
      button({
        href: telegramUrl,
        glyph: GLYPH_TELEGRAM,
        label: header ? t(L, S_TG_SHORT) : t(L, S_ASK),
        aria: product ? t(L, S_TG_LABEL, { product }) : t(L, S_ASK),
        testid: "community-telegram",
        iconOnly: header,
      }),
    );
    if (xUrl && only !== "telegram") {
      row.appendChild(
        button({
          href: xUrl,
          glyph: GLYPH_X,
          label: header ? t(L, S_X_SHORT) : xHandle ? t(L, S_FOLLOW, { handle: xHandle }) : t(L, S_FOLLOW_X),
          aria: product ? t(L, S_X_LABEL, { product }) : t(L, S_FOLLOW_X),
          testid: "community-x",
          iconOnly: header,
        }),
      );
    }
    this.#root.appendChild(row);
  }
}

function button({ href, glyph, label, aria, testid, iconOnly }) {
  const a = document.createElement("a");
  a.className = "btn";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("part", "button");
  a.setAttribute("data-testid", testid);
  // The header variant drops its visible label on a phone; the name stays.
  if (iconOnly) {
    a.setAttribute("aria-label", aria);
    a.title = aria;
  }
  a.innerHTML = glyph; // a constant, never data
  const span = document.createElement("span");
  span.className = "label";
  span.textContent = label;
  a.appendChild(span);
  return a;
}

if (typeof customElements !== "undefined" && !customElements.get("openapps-community")) {
  customElements.define("openapps-community", OpenAppsCommunity);
}
