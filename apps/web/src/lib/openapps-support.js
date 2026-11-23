// @ts-nocheck -- vendored verbatim into products whose type checkers differ;
// the source of truth is this file, tested by openapps-support.test.mjs.
/**
 * <openapps-support>: the "having trouble? ask us on Telegram" box.
 *
 * One file, no dependencies, no build step — so the same bytes drop into a
 * Svelte app, a SvelteKit SPA and a page of plain HTML. Each product copies
 * this file verbatim; this copy is the source.
 *
 * WHERE PEOPLE GO
 *
 * A click opens a small panel that sends the person to the product's topic
 * in the public OpenApps group on Telegram (`telegramUrl`, opened in a new
 * tab). If the box was opened from a failure, the panel shows the error code
 * (or, for a payment, the pending top-up id) with a Copy button and asks for
 * it to be included in the message. A quiet "Follow @Handle on X" link is
 * added when the product has an X account (`xUrl`).
 *
 * The box used to hold a message form that posted to
 * `/v1/support/messages`. That form is gone; the server route stays only so
 * that older builds keep working.
 *
 * WHAT IS SENT, EXACTLY
 *
 * Nothing, from opening the panel or following its links. What a person
 * posts on Telegram is public and governed by Telegram, not by us.
 *
 * The one request the box makes is the pending top-up lookup:
 * `GET <baseUrl>/v1/payments/topups` with the session (`getAccessToken`),
 * made only when someone is signed in and only for a box with
 * `auto="pending-topup"` (on load and after `refreshSupport()`), or when a
 * `context="payment"` panel is opened without a top-up id. The id it finds
 * is shown in the panel; it is not sent anywhere.
 *
 * USE
 *
 *   import { configureSupport } from "./openapps-support.js";
 *   configureSupport({
 *     product: "OpenPixels",                          // named in the panel
 *     telegramUrl: "https://t.me/openappsnetwork/12", // the product's topic
 *     xUrl: "https://x.com/OpenPixelsApp",            // optional
 *     xHandle: "@OpenPixelsApp",                      // optional; else from xUrl
 *     baseUrl: OPENAPPS_BASE_URL,                     // only for the top-up lookup
 *     getAccessToken: async () => token,              // ditto; null when signed out
 *   });
 *   onSessionChange(refreshSupport);                  // after sign-in and sign-out
 *
 *   <openapps-support context="export" error-code="export:QuotaExceededError"></openapps-support>
 *   <openapps-support variant="link"></openapps-support>             quiet entry point
 *   <openapps-support context="payment" auto="pending-topup"></openapps-support>
 *
 * Without `telegramUrl` the panel points at the group itself,
 * https://t.me/openappsnetwork. Keys from the old form (`appVersion`,
 * `contactEmail`, `signIn`, `powBits`, …) are accepted and ignored, so a
 * host that still passes them keeps working.
 *
 * `auto="pending-topup"` stays invisible unless the signed-in account has a
 * top-up still pending, and then offers the box with that top-up's id shown —
 * which is how a card payment that never arrived reaches us with the id
 * needed to trace it.
 *
 * LANGUAGE
 *
 * Follows `<html lang>`, re-read whenever it changes, matched exact tag →
 * Chinese script → base language → English. The catalogue is below; English
 * is the key, so a gap shows English rather than an identifier. Product
 * names, handles and links are never translated.
 *
 * THEME
 *
 * Inherits the page's design tokens through the shadow root (custom
 * properties cross it), with system colours as the fallback, so it follows
 * whatever light or dark scheme the host page is in. The Telegram button is
 * the suite's --brand unless the host sets --support-primary-bg and
 * --support-primary-fg on the element.
 */

export const DEFAULT_TELEGRAM_URL = "https://t.me/openappsnetwork";

const config = {
  product: "",
  telegramUrl: "",
  xUrl: "",
  xHandle: "",
  /** Only for the pending top-up lookup. */
  baseUrl: "",
  /** @type {null | (() => Promise<string | null> | string | null)} */
  getAccessToken: null,
};

/*
 * Settled by the first configureSupport(). An element written into static
 * HTML upgrades the moment this module defines it — before the host's own
 * module has had the chance to configure anything — so whatever needs the
 * session waits on this rather than finding no way to ask for one.
 */
let markConfigured;
const configured = new Promise((resolve) => (markConfigured = resolve));

/** Set once at start-up. Later calls merge. Unknown keys are kept and ignored. */
export function configureSupport(options = {}) {
  Object.assign(config, options);
  if (config.baseUrl) config.baseUrl = String(config.baseUrl).replace(/\/+$/, "");
  markConfigured();
  for (const box of live) box.rerender();
}

/**
 * Where the panel sends people, from the config: `{ telegramUrl, xUrl,
 * xHandle }`. `xUrl` and `xHandle` are "" when the product has no X account.
 */
export function supportLinks() {
  const telegramUrl = String(config.telegramUrl || "").trim() || DEFAULT_TELEGRAM_URL;
  const xUrl = String(config.xUrl || "").trim();
  let xHandle = String(config.xHandle || "").trim();
  if (xUrl && !xHandle) {
    const last = xUrl.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
    xHandle = last && !/^(x|twitter)\.com$/i.test(last) ? last : "";
  }
  if (xHandle && !xHandle.startsWith("@")) xHandle = `@${xHandle}`;
  return { telegramUrl, xUrl, xHandle: xUrl ? xHandle : "" };
}

// ---------------------------------------------------------------- language

export const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt", "fr", "ru"];

/** exact → Chinese script → base language → English. */
export function matchLocale(raw) {
  const tag = String(raw || "en").trim();
  const exact = LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans";
  const base = lower.split("-")[0];
  return LOCALES.find((l) => l === base) || "en";
}

const P_TROUBLE = "Having trouble? Ask us on Telegram.";
const P_PAYMENT = "Paid, but the credits haven't arrived? Ask us on Telegram.";
const S_TITLE = "Ask us on Telegram";
const P_TROUBLE_LEAD = "Having trouble?";
const P_PAYMENT_LEAD = "Paid, but the credits haven't arrived?";
const S_LEDE = "We answer in the {product} topic of the OpenApps group.";
const S_LEDE_GROUP = "We answer in the OpenApps group.";
const S_PUBLIC = "The group is public, so please don't post passwords, card details or private files.";
const S_OPEN = "Open Telegram";
const S_ERROR_CODE = "Error code";
const S_TOPUP_ID = "Payment ID";
const S_INCLUDE = "Include this in your message.";
const S_COPY = "Copy";
const S_COPIED = "Copied";
const S_FOLLOW = "Follow {handle} on X";
const S_CLOSE = "Close";

/** Every English string the box can show — the keys each locale must cover. */
export const STRINGS = [
  P_TROUBLE, P_PAYMENT, P_TROUBLE_LEAD, P_PAYMENT_LEAD, S_TITLE, S_LEDE, S_LEDE_GROUP, S_PUBLIC, S_OPEN,
  S_ERROR_CODE, S_TOPUP_ID, S_INCLUDE, S_COPY, S_COPIED, S_FOLLOW, S_CLOSE,
];

const NB = " "; // French puts a no-break space before ? : ;

export const CATALOGUE = {
  "zh-Hans": {
    [P_TROUBLE]: "遇到问题？到 Telegram 上问我们。",
    [P_TROUBLE_LEAD]: "遇到问题？",
    [P_PAYMENT]: "已付款但点数还没到账？到 Telegram 上问我们。",
    [P_PAYMENT_LEAD]: "已付款但点数还没到账？",
    [S_TITLE]: "到 Telegram 上问我们",
    [S_LEDE]: "我们会在 OpenApps 群组的 {product} 话题里回复。",
    [S_LEDE_GROUP]: "我们会在 OpenApps 群组里回复。",
    [S_PUBLIC]: "群组是公开的，请不要发布密码、银行卡信息或私人文件。",
    [S_OPEN]: "打开 Telegram",
    [S_ERROR_CODE]: "错误代码",
    [S_TOPUP_ID]: "付款编号",
    [S_INCLUDE]: "发消息时请附上它。",
    [S_COPY]: "复制",
    [S_COPIED]: "已复制",
    [S_FOLLOW]: "在 X 上关注 {handle}",
    [S_CLOSE]: "关闭",
  },
  "zh-Hant": {
    [P_TROUBLE]: "遇到問題？到 Telegram 上問我們。",
    [P_TROUBLE_LEAD]: "遇到問題？",
    [P_PAYMENT]: "已付款但點數還沒入帳？到 Telegram 上問我們。",
    [P_PAYMENT_LEAD]: "已付款但點數還沒入帳？",
    [S_TITLE]: "到 Telegram 上問我們",
    [S_LEDE]: "我們會在 OpenApps 群組的 {product} 話題裡回覆。",
    [S_LEDE_GROUP]: "我們會在 OpenApps 群組裡回覆。",
    [S_PUBLIC]: "群組是公開的，請不要張貼密碼、信用卡資料或私人檔案。",
    [S_OPEN]: "開啟 Telegram",
    [S_ERROR_CODE]: "錯誤代碼",
    [S_TOPUP_ID]: "付款編號",
    [S_INCLUDE]: "傳訊息時請附上它。",
    [S_COPY]: "複製",
    [S_COPIED]: "已複製",
    [S_FOLLOW]: "在 X 上追蹤 {handle}",
    [S_CLOSE]: "關閉",
  },
  ja: {
    [P_TROUBLE]: "問題が起きましたか？Telegram でお問い合わせください。",
    [P_TROUBLE_LEAD]: "問題が起きましたか？",
    [P_PAYMENT]: "支払ったのにクレジットが届きませんか？Telegram でお問い合わせください。",
    [P_PAYMENT_LEAD]: "支払ったのにクレジットが届きませんか？",
    [S_TITLE]: "Telegram で問い合わせる",
    [S_LEDE]: "OpenApps グループの {product} トピックで回答します。",
    [S_LEDE_GROUP]: "OpenApps グループで回答します。",
    [S_PUBLIC]: "グループは公開されています。パスワード、カード情報、個人的なファイルは投稿しないでください。",
    [S_OPEN]: "Telegram を開く",
    [S_ERROR_CODE]: "エラーコード",
    [S_TOPUP_ID]: "支払い ID",
    [S_INCLUDE]: "メッセージに含めてください。",
    [S_COPY]: "コピー",
    [S_COPIED]: "コピーしました",
    [S_FOLLOW]: "X で {handle} をフォロー",
    [S_CLOSE]: "閉じる",
  },
  ko: {
    [P_TROUBLE]: "문제가 있나요? Telegram에서 문의해 주세요.",
    [P_TROUBLE_LEAD]: "문제가 있나요?",
    [P_PAYMENT]: "결제했는데 크레딧이 들어오지 않았나요? Telegram에서 문의해 주세요.",
    [P_PAYMENT_LEAD]: "결제했는데 크레딧이 들어오지 않았나요?",
    [S_TITLE]: "Telegram에서 문의하기",
    [S_LEDE]: "OpenApps 그룹의 {product} 토픽에서 답변해 드립니다.",
    [S_LEDE_GROUP]: "OpenApps 그룹에서 답변해 드립니다.",
    [S_PUBLIC]: "그룹은 공개되어 있으니 비밀번호, 카드 정보, 개인 파일은 올리지 마세요.",
    [S_OPEN]: "Telegram 열기",
    [S_ERROR_CODE]: "오류 코드",
    [S_TOPUP_ID]: "결제 ID",
    [S_INCLUDE]: "메시지에 함께 적어 주세요.",
    [S_COPY]: "복사",
    [S_COPIED]: "복사됨",
    [S_FOLLOW]: "X에서 {handle} 팔로우",
    [S_CLOSE]: "닫기",
  },
  de: {
    [P_TROUBLE]: "Probleme? Fragen Sie uns auf Telegram.",
    [P_TROUBLE_LEAD]: "Probleme?",
    [P_PAYMENT]: "Bezahlt, aber die Credits sind nicht angekommen? Fragen Sie uns auf Telegram.",
    [P_PAYMENT_LEAD]: "Bezahlt, aber die Credits sind nicht angekommen?",
    [S_TITLE]: "Fragen Sie uns auf Telegram",
    [S_LEDE]: "Wir antworten im Thema {product} der OpenApps-Gruppe.",
    [S_LEDE_GROUP]: "Wir antworten in der OpenApps-Gruppe.",
    [S_PUBLIC]: "Die Gruppe ist öffentlich – bitte posten Sie dort keine Passwörter, Kartendaten oder privaten Dateien.",
    [S_OPEN]: "Telegram öffnen",
    [S_ERROR_CODE]: "Fehlercode",
    [S_TOPUP_ID]: "Zahlungs-ID",
    [S_INCLUDE]: "Bitte in Ihrer Nachricht angeben.",
    [S_COPY]: "Kopieren",
    [S_COPIED]: "Kopiert",
    [S_FOLLOW]: "{handle} auf X folgen",
    [S_CLOSE]: "Schließen",
  },
  es: {
    [P_TROUBLE]: "¿Tienes problemas? Pregúntanos en Telegram.",
    [P_TROUBLE_LEAD]: "¿Tienes problemas?",
    [P_PAYMENT]: "¿Pagaste y los créditos no han llegado? Pregúntanos en Telegram.",
    [P_PAYMENT_LEAD]: "¿Pagaste y los créditos no han llegado?",
    [S_TITLE]: "Pregúntanos en Telegram",
    [S_LEDE]: "Respondemos en el tema {product} del grupo de OpenApps.",
    [S_LEDE_GROUP]: "Respondemos en el grupo de OpenApps.",
    [S_PUBLIC]: "El grupo es público: no publiques contraseñas, datos de tarjetas ni archivos privados.",
    [S_OPEN]: "Abrir Telegram",
    [S_ERROR_CODE]: "Código de error",
    [S_TOPUP_ID]: "ID del pago",
    [S_INCLUDE]: "Inclúyelo en tu mensaje.",
    [S_COPY]: "Copiar",
    [S_COPIED]: "Copiado",
    [S_FOLLOW]: "Sigue a {handle} en X",
    [S_CLOSE]: "Cerrar",
  },
  pt: {
    [P_TROUBLE]: "Está com problemas? Pergunte para a gente no Telegram.",
    [P_TROUBLE_LEAD]: "Está com problemas?",
    [P_PAYMENT]: "Pagou e os créditos não chegaram? Pergunte para a gente no Telegram.",
    [P_PAYMENT_LEAD]: "Pagou e os créditos não chegaram?",
    [S_TITLE]: "Pergunte para a gente no Telegram",
    [S_LEDE]: "Respondemos no tópico {product} do grupo da OpenApps.",
    [S_LEDE_GROUP]: "Respondemos no grupo da OpenApps.",
    [S_PUBLIC]: "O grupo é público: não publique senhas, dados de cartão nem arquivos privados.",
    [S_OPEN]: "Abrir o Telegram",
    [S_ERROR_CODE]: "Código do erro",
    [S_TOPUP_ID]: "ID do pagamento",
    [S_INCLUDE]: "Inclua isto na sua mensagem.",
    [S_COPY]: "Copiar",
    [S_COPIED]: "Copiado",
    [S_FOLLOW]: "Siga {handle} no X",
    [S_CLOSE]: "Fechar",
  },
  fr: {
    [P_TROUBLE]: `Un problème${NB}? Posez-nous la question sur Telegram.`,
    [P_TROUBLE_LEAD]: `Un problème${NB}?`,
    [P_PAYMENT]: `Vous avez payé mais les crédits ne sont pas arrivés${NB}? Posez-nous la question sur Telegram.`,
    [P_PAYMENT_LEAD]: `Vous avez payé mais les crédits ne sont pas arrivés${NB}?`,
    [S_TITLE]: "Posez-nous la question sur Telegram",
    [S_LEDE]: "Nous répondons dans le sujet {product} du groupe OpenApps.",
    [S_LEDE_GROUP]: "Nous répondons dans le groupe OpenApps.",
    [S_PUBLIC]: `Le groupe est public${NB}: n'y publiez ni mot de passe, ni données de carte, ni fichier privé.`,
    [S_OPEN]: "Ouvrir Telegram",
    [S_ERROR_CODE]: "Code d'erreur",
    [S_TOPUP_ID]: "Identifiant du paiement",
    [S_INCLUDE]: "Indiquez-le dans votre message.",
    [S_COPY]: "Copier",
    [S_COPIED]: "Copié",
    [S_FOLLOW]: "Suivre {handle} sur X",
    [S_CLOSE]: "Fermer",
  },
  ru: {
    [P_TROUBLE]: "Что-то не получается? Спросите нас в Telegram.",
    [P_TROUBLE_LEAD]: "Что-то не получается?",
    [P_PAYMENT]: "Оплатили, а кредиты не пришли? Спросите нас в Telegram.",
    [P_PAYMENT_LEAD]: "Оплатили, а кредиты не пришли?",
    [S_TITLE]: "Спросите нас в Telegram",
    [S_LEDE]: "Мы отвечаем в теме {product} группы OpenApps.",
    [S_LEDE_GROUP]: "Мы отвечаем в группе OpenApps.",
    [S_PUBLIC]: "Группа публичная: не публикуйте пароли, данные карт и личные файлы.",
    [S_OPEN]: "Открыть Telegram",
    [S_ERROR_CODE]: "Код ошибки",
    [S_TOPUP_ID]: "ID платежа",
    [S_INCLUDE]: "Укажите его в сообщении.",
    [S_COPY]: "Копировать",
    [S_COPIED]: "Скопировано",
    [S_FOLLOW]: "Подписаться на {handle} в X",
    [S_CLOSE]: "Закрыть",
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

// --------------------------------------------------------- pending top-up

const live = new Set();

/**
 * Call after a sign-in or a sign-out: an `auto="pending-topup"` box looks
 * again for a pending top-up of whoever is there now.
 */
export function refreshSupport() {
  for (const box of live) box.refreshAccess();
}

async function accessToken() {
  if (!config.getAccessToken) return null;
  try {
    return (await config.getAccessToken()) || null;
  } catch {
    return null;
  }
}

/** The newest pending top-up of the signed-in account, or null. */
export async function findPendingTopup(token) {
  if (!token || !config.baseUrl) return null;
  try {
    const abort = typeof AbortController === "undefined" ? null : new AbortController();
    const timer = abort && setTimeout(() => abort.abort(), 4000);
    const res = await fetch(`${config.baseUrl}/v1/payments/topups`, {
      headers: { authorization: `Bearer ${token}` },
      ...(abort ? { signal: abort.signal } : {}),
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    const body = await res.json();
    const pending = (body?.topups ?? []).find((t) => t?.status === "pending");
    return pending?.id ?? null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- element

// Brand glyphs (Simple Icons, CC0): Lucide, the suite's icon set, has no
// Telegram or X mark. Filled with currentColor so they take the link's colour
// like every Lucide glyph does.
const GLYPH_TELEGRAM =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';
const GLYPH_X =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';

const STYLE = `
:host { display: block; font: inherit; color: var(--text-muted, GrayText); }
:host([hidden]), :host([data-empty]) { display: none !important; }
:host([variant="link"]) { display: inline-block; }
* { box-sizing: border-box; }
/* The design system's secondary button: hairline --border-strong border,
   --text-strong label, transparent fill; green border and label on hover.
   The Telegram and X buttons are the same kind of thing and look it. */
.trigger, .quiet {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: var(--control-h-md, 36px); padding: 0 14px; cursor: pointer;
  border: 1px solid var(--border-strong, color-mix(in srgb, CanvasText 30%, transparent));
  border-radius: var(--radius-md, 8px); background: transparent;
  color: var(--text-strong, CanvasText); text-decoration: none; white-space: nowrap;
  font: inherit; font-size: var(--text-sm, 14px); font-weight: 500; line-height: 1;
  transition: color .15s, border-color .15s, background-color .15s;
}
.trigger svg, .quiet svg { flex: none; width: 16px; height: 16px; }
.trigger:hover, .quiet:hover {
  color: var(--text-link-hover, #00c896); border-color: currentColor; text-decoration: none;
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.trigger:focus-visible, .quiet:focus-visible, .btn:focus-visible, .follow:focus-visible {
  outline: 2px solid var(--border-focus, Highlight); outline-offset: 2px;
}
.links { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
/* A prompt at a failure: the question, then the button. */
.prompt { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.prompt-lead { color: var(--text-muted, GrayText); font-size: var(--text-sm, 14px); line-height: 1.45; }
@media (pointer: coarse) { .trigger, .quiet { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .trigger, .quiet { transition: none; } }

dialog {
  color-scheme: inherit;
  width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 32px);
  margin: auto; padding: 0; overflow: auto; overflow-wrap: anywhere;
  border: 1px solid var(--border-hairline, color-mix(in srgb, CanvasText 15%, transparent));
  border-radius: var(--radius-xl, 14px);
  background: var(--surface-card, Canvas); color: var(--text-body, CanvasText);
  box-shadow: var(--shadow-xl, 0 24px 60px rgba(0,0,0,.25));
  font-family: var(--font-sans, system-ui, sans-serif);
}
dialog::backdrop { background: rgba(0, 0, 0, .45); }
.body { padding: 22px 22px 20px; display: grid; gap: 14px; }
h2 { margin: 0; font-size: var(--text-lg, 18px); font-weight: 500; color: var(--text-strong, CanvasText); line-height: 1.3; }
p { margin: 0; }
.lede, .hint { color: var(--text-muted, GrayText); font-size: var(--text-sm, 14px); line-height: 1.45; }
.hint { font-size: var(--text-xs, 12px); }
.code {
  display: grid; gap: 6px; padding: 10px 12px;
  border: 1px solid var(--border-hairline, color-mix(in srgb, CanvasText 15%, transparent));
  border-radius: var(--radius-md, 8px); background: var(--bg-page, Field);
}
.code-label { font-size: var(--text-xs, 12px); color: var(--text-muted, GrayText); }
.code-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.ref { font-family: var(--font-mono, ui-monospace, monospace); color: var(--text-strong, CanvasText); user-select: all; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; text-decoration: none;
  font: inherit; font-size: var(--text-sm, 14px); font-weight: 500; min-height: var(--control-h-md, 36px);
  padding: 0 16px; border-radius: var(--radius-md, 8px); cursor: pointer;
  border: 1px solid var(--border-strong, color-mix(in srgb, CanvasText 30%, transparent));
  background: var(--surface-card, Canvas); color: var(--text-strong, CanvasText);
}
.btn.small { min-height: 28px; padding: 0 10px; font-size: var(--text-xs, 12px); flex: none; }
/* A host whose primary action is not the suite green (OpenPixels draws it
   with the inverse pair) sets --support-primary-bg / -fg on the element. */
.btn.primary {
  background: var(--support-primary-bg, var(--brand, #00c896));
  color: var(--support-primary-fg, var(--brand-contrast, #020202)); border-color: transparent;
}
.btn svg { width: 16px; height: 16px; margin-inline-end: 8px; flex: none; }
.follow {
  justify-self: start; display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--text-xs, 12px); color: var(--text-muted, GrayText); text-decoration: none;
}
.follow svg { width: 14px; height: 14px; flex: none; }
.follow:hover { color: var(--text-link-hover, CanvasText); text-decoration: none; }
@media (pointer: coarse) { .btn { min-height: 44px; } .btn.small { min-height: 36px; } }
`;

let uid = 0;

export class OpenAppsSupportElement extends (typeof HTMLElement === "undefined" ? class {} : HTMLElement) {
  static observedAttributes = ["context", "error-code", "topup-id", "variant", "auto"];

  #root = null;
  #triggerBox = null;
  #langObserver = null;
  #pendingTopup = null;
  #opts = null;
  #copied = false;
  #openRun = 0;

  connectedCallback() {
    if (!this.#root) {
      // The trigger and the dialog live side by side, so redrawing the
      // trigger (a language change, a new error code) never touches a
      // dialog that is open — taking an open modal out of the DOM closes it.
      this.#root = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      this.#triggerBox = document.createElement("span");
      this.#root.append(style, this.#triggerBox);
    }
    live.add(this);
    this.#renderTrigger();
    // The app may switch language without a reload; follow it.
    this.#langObserver = new MutationObserver(() => this.rerender());
    this.#langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    if (this.#auto) void this.#checkPendingTopup();
  }

  disconnectedCallback() {
    live.delete(this);
    this.#langObserver?.disconnect();
  }

  /** After a sign-in or sign-out: an auto box looks for a pending top-up again. */
  async refreshAccess() {
    if (this.#auto) await this.#checkPendingTopup();
  }

  attributeChangedCallback() {
    if (this.#root) this.#renderTrigger();
  }

  get #auto() {
    return this.getAttribute("auto") === "pending-topup";
  }

  get #context() {
    return this.#opts?.context ?? this.getAttribute("context") ?? "general";
  }

  /** What the panel asks to be included: `{ label, value }` or null. */
  get #code() {
    const errorCode = this.#opts?.errorCode ?? this.getAttribute("error-code");
    if (errorCode) return { label: S_ERROR_CODE, value: String(errorCode) };
    const topup = this.#opts?.topupId ?? this.getAttribute("topup-id") ?? this.#pendingTopup;
    if (topup) return { label: S_TOPUP_ID, value: String(topup) };
    return null;
  }

  async #checkPendingTopup() {
    if (this.#pendingTopup == null) this.setAttribute("data-empty", "");
    await configured;
    const id = await findPendingTopup(await accessToken());
    this.#pendingTopup = id;
    if (id) this.removeAttribute("data-empty");
    else this.setAttribute("data-empty", "");
    this.rerender();
  }

  /** Redraw for a new language or a new config; an open panel stays open. */
  rerender() {
    if (!this.#root) return;
    this.#renderTrigger();
    const dialog = this.#root.querySelector("dialog");
    if (dialog?.open) this.#renderDialog(dialog);
  }

  #renderTrigger() {
    const L = pageLocale();
    const variant = this.getAttribute("variant") ?? "prompt";
    const payment = this.#context === "payment";
    const label = t(L, S_TITLE);
    this.#triggerBox.textContent = "";
    if (variant !== "none") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "trigger";
      button.setAttribute("part", "trigger");
      button.setAttribute("data-testid", "support-trigger");
      button.innerHTML = GLYPH_TELEGRAM; // a constant, never data
      const span = document.createElement("span");
      span.textContent = label;
      button.appendChild(span);
      button.addEventListener("click", () => this.open());
      // The quiet entry point carries the X line beside it, drawn the same
      // way, so a host never puts a differently styled link next to it.
      const { xUrl, xHandle } = supportLinks();
      if (variant === "link" && xUrl) {
        const row = el("span", { class: "links" });
        const follow = el("a", { class: "quiet", href: xUrl, target: "_blank", rel: "noopener", "data-testid": "support-x-quiet" });
        follow.innerHTML = GLYPH_X; // a constant, never data
        follow.appendChild(el("span", {}, xHandle ? t(L, S_FOLLOW, { handle: xHandle }) : "X"));
        row.append(button, follow);
        this.#triggerBox.appendChild(row);
      } else if (variant === "link") {
        this.#triggerBox.appendChild(button);
      } else {
        // At a failure: the question in words, then the button that answers it.
        const prompt = el("span", { class: "prompt" });
        prompt.append(el("span", { class: "prompt-lead" }, t(L, payment ? P_PAYMENT_LEAD : P_TROUBLE_LEAD)), button);
        this.#triggerBox.appendChild(prompt);
      }
    }
  }

  /**
   * Open the panel. `opts` (`{ context, errorCode, topupId }`) overrides the
   * attributes for this opening. Nothing is sent, except that a payment panel
   * with no top-up id looks one up for a signed-in account.
   */
  open(opts = null) {
    if (!this.#root) this.connectedCallback();
    const run = ++this.#openRun;
    this.#opts = opts;
    this.#copied = false;
    let dialog = this.#root.querySelector("dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      this.#root.appendChild(dialog);
    }
    this.#renderDialog(dialog);
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    dialog.querySelector(".btn.primary")?.focus();
    if (this.#context === "payment" && !this.#code) {
      void (async () => {
        const id = await findPendingTopup(await accessToken());
        if (id && run === this.#openRun) {
          this.#pendingTopup = id;
          if (dialog.open) this.#renderDialog(dialog);
        }
      })();
    }
  }

  #renderDialog(dialog) {
    const L = pageLocale();
    const { telegramUrl, xUrl, xHandle } = supportLinks();
    const id = `oa-support-${++uid}`;
    dialog.textContent = "";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.setAttribute("lang", L);
    const body = el("div", { class: "body", "data-testid": "support-panel" });
    dialog.appendChild(body);
    body.appendChild(el("h2", { id: `${id}-title` }, t(L, S_TITLE)));
    const product = String(config.product || "").trim();
    body.appendChild(el("p", { class: "lede" }, product ? t(L, S_LEDE, { product }) : t(L, S_LEDE_GROUP)));

    const code = this.#code;
    if (code) {
      const box = el("div", { class: "code", "data-testid": "support-code" });
      box.appendChild(el("span", { class: "code-label" }, t(L, code.label)));
      const row = el("div", { class: "code-row" });
      const value = el("span", { class: "ref", "data-testid": "support-code-value" }, code.value);
      const copy = el(
        "button",
        { type: "button", class: "btn small", "data-testid": "support-copy" },
        t(L, this.#copied ? S_COPIED : S_COPY),
      );
      copy.addEventListener("click", async () => {
        if (await copyText(code.value, value)) {
          this.#copied = true;
          copy.textContent = t(pageLocale(), S_COPIED);
        }
      });
      row.append(value, copy);
      box.appendChild(row);
      box.appendChild(el("span", { class: "hint" }, t(L, S_INCLUDE)));
      body.appendChild(box);
    }

    body.appendChild(el("p", { class: "hint" }, t(L, S_PUBLIC)));

    const actions = el("div", { class: "actions" });
    if (xUrl) {
      const follow = el("a", { class: "follow", href: xUrl, target: "_blank", rel: "noopener", "data-testid": "support-x" });
      follow.innerHTML = GLYPH_X; // a constant, never data
      follow.appendChild(el("span", {}, xHandle ? t(L, S_FOLLOW, { handle: xHandle }) : "X"));
      // Its own line, above the buttons: beside them it pushed Open Telegram
      // onto a second row at the panel's width.
      body.appendChild(follow);
    }
    const close = el("button", { type: "button", class: "btn" }, t(L, S_CLOSE));
    close.addEventListener("click", () => dialog.close());
    const go = el("a", { class: "btn primary", href: telegramUrl, target: "_blank", rel: "noopener", "data-testid": "support-telegram" });
    go.innerHTML = GLYPH_TELEGRAM; // a constant, never data
    go.appendChild(el("span", {}, t(L, S_OPEN)));
    actions.append(close, go);
    body.appendChild(actions);
  }
}

/** Clipboard first; else select the text so the person can copy it. */
async function copyText(text, node) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to selecting it */
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    /* nothing more to try */
  }
  return false;
}

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

if (typeof customElements !== "undefined" && !customElements.get("openapps-support")) {
  customElements.define("openapps-support", OpenAppsSupportElement);
}

let shared = null;

/**
 * Open the panel from code — from a catch block, say — without placing an
 * element first. `{ context, errorCode, topupId }`.
 */
export function openSupport(opts = {}) {
  if (typeof document === "undefined") return;
  if (!shared || !shared.isConnected) {
    shared = document.createElement("openapps-support");
    shared.setAttribute("variant", "none");
    document.body.appendChild(shared);
  }
  shared.open(opts);
}
