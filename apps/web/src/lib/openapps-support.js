// @ts-nocheck -- vendored verbatim into products whose type checkers differ;
// the source of truth is this file, tested by openapps-support.test.mjs.
/**
 * <openapps-support>: the "having trouble? leave us a message" box.
 *
 * One file, no dependencies, no build step — so the same bytes drop into a
 * Svelte app, a SvelteKit SPA and a page of plain HTML. Each product copies
 * this file verbatim; this copy is the source.
 *
 * WHERE THE MESSAGE GOES
 *
 * `POST <baseUrl>/v1/support/messages`, on the product's own account host
 * (`https://auth.<product-domain>`). The server keeps it for the team's
 * operator console and posts a short notice — never the reply address — to
 * the team's chat. Nothing is shown to any other user, and there is no route
 * that lists messages back to anyone, including the sender.
 *
 * WHAT IS SENT, EXACTLY
 *
 *   message      what the person typed (≤ 2000 characters)
 *   email        only if they type one
 *   context      export | signin | payment | general — where the box was
 *   page         location.origin + location.pathname; never the query or
 *                the fragment, which can hold a sign-in code or a file name
 *   product      the product's name (the server prefers its own Host map)
 *   app_version  the build
 *   error_code   a short code from the failure that opened the box
 *   locale       the interface language
 *   topup_id     a pending top-up of the signed-in account (payment only)
 *   Authorization  the session, when signed in, so the account is attached
 *   pow.nonce    a small proof of work (see below)
 *
 * The browser adds its User-Agent; the server uses the IP address for rate
 * limiting only and does not store it with the message. No file, screenshot
 * or document content is ever attached.
 *
 * USE
 *
 *   import { configureSupport } from "./openapps-support.js";
 *   configureSupport({
 *     baseUrl: OPENAPPS_BASE_URL,         // https://auth.<product-domain>
 *     product: "OpenPixels",
 *     appVersion: "1.0.9",
 *     getAccessToken: async () => token,  // or null when signed out
 *     contactEmail: "hello@openpixels.app", // offered where sign-in failed
 *     signIn: () => { location.hash = "#/account"; }, // the product's own sign-in
 *   });
 *   onSessionChange(refreshSupport);      // after sign-in and sign-out
 *
 *   <openapps-support context="export" error-code="export:QuotaExceededError"></openapps-support>
 *   <openapps-support variant="link"></openapps-support>             quiet entry point
 *   <openapps-support context="payment" auto="pending-topup"></openapps-support>
 *
 * WHO MAY WRITE
 *
 * Loading a page with the box on it sends nothing anywhere. The box is shown
 * to everyone; what happens on a click depends on who is asking:
 *
 *   - signed in: the form, always;
 *   - signed out: only now does the box ask the server, once per page, on
 *     `GET <baseUrl>/v1/auth/methods`, whether it takes messages from
 *     signed-out visitors (`support.require_signin`). If it does not, the
 *     box says so and offers the host's sign-in (`signIn` in the config)
 *     instead of the form; at a failed sign-in (`context="signin"`) it adds
 *     the product's contact address (`contactEmail`). If the answer cannot
 *     be had, or an old server does not say, the form opens as before; the
 *     server still decides on send.
 *
 * So one server setting switches every product, with no redeploy. The host
 * calls `refreshSupport()` after a sign-in or sign-out so the next click
 * asks again who is there.
 *
 * `auto="pending-topup"` stays invisible unless the signed-in account has a
 * top-up still pending, and then offers the box with that top-up attached —
 * which is how a card payment that never arrived reaches us with the id
 * needed to trace it.
 *
 * LANGUAGE
 *
 * Follows `<html lang>`, re-read whenever it changes, matched exact tag →
 * Chinese script → base language → English. The catalogue is below; English
 * is the key, so a gap shows English rather than an identifier.
 *
 * THEME
 *
 * Inherits the page's design tokens through the shadow root (custom
 * properties cross it), with system colours as the fallback, so it follows
 * whatever light or dark scheme the host page is in. The send button is the
 * suite's --brand unless the host sets --support-primary-bg and
 * --support-primary-fg on the element.
 */

const MAX_CHARS = 2000;
const RETENTION_DAYS = 180;
const DEFAULT_POW_BITS = 14;

const config = {
  baseUrl: "",
  product: "",
  appVersion: "",
  /** @type {null | (() => Promise<string | null> | string | null)} */
  getAccessToken: null,
  powBits: DEFAULT_POW_BITS,
  /** Offered where a sign-in failed while only signed-in visitors may write. */
  contactEmail: "",
  /** Opens the product's own sign-in; the box offers it when one is needed. */
  /** @type {null | (() => void)} */
  signIn: null,
};

/*
 * Settled by the first configureSupport(). An element written into static
 * HTML upgrades the moment this module defines it — before the host's own
 * module has had the chance to configure anything — so whatever needs the
 * session waits on this rather than finding no way to ask for one.
 */
let markConfigured;
const configured = new Promise((resolve) => (markConfigured = resolve));

/** Set once at start-up. Later calls merge. */
export function configureSupport(options = {}) {
  Object.assign(config, options);
  if (config.baseUrl) config.baseUrl = String(config.baseUrl).replace(/\/+$/, "");
  markConfigured();
}

// ---------------------------------------------------------------- language

export const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt", "fr"];

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

const P_TROUBLE = "Having trouble? Leave us a message and we'll sort it out.";
const P_PAYMENT = "Paid, but the credits haven't arrived? Leave us a message and we'll sort it out.";
const S_TITLE = "Message our team";
// Said plainly because people took the box for a prompt: one asked it, in
// two thousand characters, to restore their photo.
const S_LEDE =
  "This message goes to the people who make this app. It does not change your file, and it is not a prompt for the AI. Only our team reads it; it is never shown on the site.";
const S_WHAT = "What happened?";
const S_PLACEHOLDER = "For our team: what went wrong, which button you pressed, and what you saw instead.";
const S_EMAIL = "Your email (optional)";
const S_EMAIL_HINT = "So we can reply. Leave it empty to write anonymously.";
// Signed in, the account goes with the message, so "anonymously" is untrue.
const S_EMAIL_HINT_SIGNED = "So we can reply by email. Leave it empty if you don't need a reply.";
const S_SENT_WITH = "What is sent with your message";
const S_ITEM_TEXT = "Your message, and your email if you give one.";
const S_ITEM_APP = "This app's name, version and language, the page you're on, and your browser.";
const S_ITEM_ERROR = "The error code, if this box was opened from an error.";
const S_ITEM_ACCOUNT = "Your account ID, if you're signed in.";
const S_ITEM_ACCOUNT_SIGNED = "Your account ID.";
const S_ITEM_TOPUP = "The ID of your pending payment, so we can trace it.";
const S_ITEM_IP =
  "Your IP address is used only to limit how many messages can be sent. It is not stored with your message.";
const S_ITEM_KEPT = "Messages are kept for {days} days, then deleted.";
const S_CANCEL = "Cancel";
const S_SEND = "Send message";
const S_SENDING = "Sending…";
const S_THANKS = "Thanks — we've got your message.";
const S_REF = "Your reference is {ref}.";
const S_REPLY = "We'll reply to {email}.";
const S_NO_REPLY = "You didn't leave an email, so we can't write back, but we will look into it.";
const S_CLOSE = "Close";
const E_EMPTY = "Please describe what happened.";
const E_EMAIL = "That email address doesn't look right.";
const E_LONG = "Please keep it under {max} characters.";
const E_RATE_YOU = "You've sent a few messages just now. Please try again in {minutes} minutes.";
const E_RATE_ALL = "We're receiving a lot of messages right now. Please try again in a few minutes.";
const E_NETWORK = "Couldn't send your message. Check your connection and try again.";
const E_SIGNIN = "Please sign in to send us a message.";
const S_SIGNIN_HELP = "Still can't sign in? Email us at {email}.";
const S_SIGNIN_BUTTON = "Sign in";

/** Every English string the box can show — the keys each locale must cover. */
export const STRINGS = [
  P_TROUBLE, P_PAYMENT, S_TITLE, S_LEDE, S_WHAT, S_PLACEHOLDER, S_EMAIL, S_EMAIL_HINT,
  S_EMAIL_HINT_SIGNED, S_SENT_WITH, S_ITEM_TEXT, S_ITEM_APP, S_ITEM_ERROR, S_ITEM_ACCOUNT,
  S_ITEM_ACCOUNT_SIGNED, S_ITEM_TOPUP, S_ITEM_IP, S_ITEM_KEPT, S_CANCEL, S_SEND, S_SENDING,
  S_THANKS, S_REF, S_REPLY, S_NO_REPLY, S_CLOSE, S_SIGNIN_HELP, S_SIGNIN_BUTTON,
  E_EMPTY, E_EMAIL, E_LONG, E_RATE_YOU, E_RATE_ALL, E_NETWORK, E_SIGNIN,
];

const NB = "\u00a0"; // French puts a no-break space before ? : ;

export const CATALOGUE = {
  "zh-Hans": {
    [P_TROUBLE]: "遇到问题？给我们留言，我们会尽快处理。",
    [P_PAYMENT]: "已付款但点数还没到账？给我们留言，我们会尽快处理。",
    [S_TITLE]: "给我们团队留言",
    [S_LEDE]: "这条留言会发给开发这个应用的团队，不会修改你的文件，也不是给 AI 的指令。只有我们的团队能看到，不会显示在网站上。",
    [S_WHAT]: "发生了什么？",
    [S_PLACEHOLDER]: "写给我们团队：哪里出了问题，你点了哪个按钮，结果看到了什么。",
    [S_EMAIL]: "你的邮箱（选填）",
    [S_EMAIL_HINT]: "方便我们回复你。不填也可以匿名留言。",
    [S_EMAIL_HINT_SIGNED]: "方便我们用邮件回复你。不需要回复可以不填。",
    [S_SENT_WITH]: "留言会附带哪些信息",
    [S_ITEM_TEXT]: "你的留言内容，以及你填写的邮箱（如有）。",
    [S_ITEM_APP]: "本应用的名称、版本和界面语言，你所在的页面，以及你的浏览器信息。",
    [S_ITEM_ERROR]: "错误代码（如果留言框是从报错处打开的）。",
    [S_ITEM_ACCOUNT]: "你的账户 ID（如果已登录）。",
    [S_ITEM_ACCOUNT_SIGNED]: "你的账户 ID。",
    [S_ITEM_TOPUP]: "你待到账付款的编号，方便我们查询。",
    [S_ITEM_IP]: "你的 IP 地址只用于限制留言次数，不会和留言一起保存。",
    [S_ITEM_KEPT]: "留言保存 {days} 天，之后删除。",
    [S_CANCEL]: "取消",
    [S_SEND]: "发送留言",
    [S_SENDING]: "正在发送…",
    [S_THANKS]: "谢谢，我们已收到你的留言。",
    [S_REF]: "你的留言编号是 {ref}。",
    [S_REPLY]: "我们会回复到 {email}。",
    [S_NO_REPLY]: "你没有留下邮箱，所以我们无法回复你，但我们会处理这个问题。",
    [S_CLOSE]: "关闭",
    [S_SIGNIN_HELP]: "还是登录不了？请发邮件到 {email}。",
    [S_SIGNIN_BUTTON]: "登录",
    [E_EMPTY]: "请描述一下发生了什么。",
    [E_EMAIL]: "这个邮箱地址看起来不对。",
    [E_LONG]: "请控制在 {max} 个字以内。",
    [E_RATE_YOU]: "你刚刚已经发送了几条留言，请 {minutes} 分钟后再试。",
    [E_RATE_ALL]: "我们现在收到的留言较多，请过几分钟再试。",
    [E_NETWORK]: "留言发送失败。请检查网络连接后重试。",
    [E_SIGNIN]: "请先登录，再给我们留言。",
  },
  "zh-Hant": {
    [P_TROUBLE]: "遇到問題？留言給我們，我們會盡快處理。",
    [P_PAYMENT]: "已付款但點數還沒入帳？留言給我們，我們會盡快處理。",
    [S_TITLE]: "留言給我們的團隊",
    [S_LEDE]: "這則留言會寄給開發這個應用程式的團隊，不會修改你的檔案，也不是給 AI 的指令。只有我們的團隊看得到，不會顯示在網站上。",
    [S_WHAT]: "發生了什麼事？",
    [S_PLACEHOLDER]: "寫給我們的團隊：哪裡出了問題，你按了哪個按鈕，結果看到了什麼。",
    [S_EMAIL]: "你的電子郵件（選填）",
    [S_EMAIL_HINT]: "方便我們回覆你。不填也可以匿名留言。",
    [S_EMAIL_HINT_SIGNED]: "方便我們用電子郵件回覆你。不需要回覆可以不填。",
    [S_SENT_WITH]: "留言會附上哪些資訊",
    [S_ITEM_TEXT]: "你的留言內容，以及你填寫的電子郵件（如有）。",
    [S_ITEM_APP]: "本應用程式的名稱、版本和介面語言、你所在的頁面，以及你的瀏覽器資訊。",
    [S_ITEM_ERROR]: "錯誤代碼（如果留言框是從錯誤訊息開啟的）。",
    [S_ITEM_ACCOUNT]: "你的帳號 ID（如果已登入）。",
    [S_ITEM_ACCOUNT_SIGNED]: "你的帳號 ID。",
    [S_ITEM_TOPUP]: "你尚未入帳的付款編號，方便我們追查。",
    [S_ITEM_IP]: "你的 IP 位址只用來限制留言次數，不會和留言一起儲存。",
    [S_ITEM_KEPT]: "留言會保存 {days} 天，之後刪除。",
    [S_CANCEL]: "取消",
    [S_SEND]: "送出留言",
    [S_SENDING]: "傳送中…",
    [S_THANKS]: "謝謝，我們已收到你的留言。",
    [S_REF]: "你的留言編號是 {ref}。",
    [S_REPLY]: "我們會回覆到 {email}。",
    [S_NO_REPLY]: "你沒有留下電子郵件，所以我們無法回覆你，但我們會處理這個問題。",
    [S_CLOSE]: "關閉",
    [S_SIGNIN_HELP]: "還是無法登入？請寄信到 {email}。",
    [S_SIGNIN_BUTTON]: "登入",
    [E_EMPTY]: "請描述一下發生了什麼事。",
    [E_EMAIL]: "這個電子郵件地址看起來不正確。",
    [E_LONG]: "請控制在 {max} 個字以內。",
    [E_RATE_YOU]: "你剛剛已經送出好幾則留言，請 {minutes} 分鐘後再試。",
    [E_RATE_ALL]: "我們目前收到很多留言，請過幾分鐘再試。",
    [E_NETWORK]: "留言送出失敗。請檢查網路連線後再試一次。",
    [E_SIGNIN]: "請先登入，再留言給我們。",
  },
  ja: {
    [P_TROUBLE]: "問題が起きましたか？メッセージをお送りください。こちらで対応します。",
    [P_PAYMENT]: "支払ったのにクレジットが届きませんか？メッセージをお送りください。こちらで対応します。",
    [S_TITLE]: "開発チームへのメッセージ",
    [S_LEDE]: "このメッセージはアプリの開発チームに届きます。ファイルは変更されず、AI への指示にもなりません。読むのは私たちのチームだけで、サイトに表示されることはありません。",
    [S_WHAT]: "何が起きましたか？",
    [S_PLACEHOLDER]: "チームへ：何が起きたか、どのボタンを押したか、代わりに何が表示されたか。",
    [S_EMAIL]: "メールアドレス（任意）",
    [S_EMAIL_HINT]: "返信用です。空欄のままなら匿名で送信できます。",
    [S_EMAIL_HINT_SIGNED]: "メールで返信するためです。返信が不要なら空欄のままで構いません。",
    [S_SENT_WITH]: "メッセージと一緒に送信される情報",
    [S_ITEM_TEXT]: "メッセージの内容と、入力した場合はメールアドレス。",
    [S_ITEM_APP]: "このアプリの名前・バージョン・表示言語、表示中のページ、ブラウザーの情報。",
    [S_ITEM_ERROR]: "エラーからこの画面を開いた場合は、そのエラーコード。",
    [S_ITEM_ACCOUNT]: "サインインしている場合は、アカウント ID。",
    [S_ITEM_ACCOUNT_SIGNED]: "アカウント ID。",
    [S_ITEM_TOPUP]: "確認のため、処理中の支払いの ID。",
    [S_ITEM_IP]: "IP アドレスは送信回数の制限にのみ使い、メッセージと一緒には保存しません。",
    [S_ITEM_KEPT]: "メッセージは {days} 日間保存した後、削除します。",
    [S_CANCEL]: "キャンセル",
    [S_SEND]: "送信",
    [S_SENDING]: "送信中…",
    [S_THANKS]: "ありがとうございます。メッセージを受け取りました。",
    [S_REF]: "受付番号は {ref} です。",
    [S_REPLY]: "{email} 宛てに返信します。",
    [S_NO_REPLY]: "メールアドレスがないため返信はできませんが、内容を確認して対応します。",
    [S_CLOSE]: "閉じる",
    [S_SIGNIN_HELP]: "それでもサインインできない場合は、{email} までメールでお知らせください。",
    [S_SIGNIN_BUTTON]: "サインイン",
    [E_EMPTY]: "何が起きたかを入力してください。",
    [E_EMAIL]: "メールアドレスの形式が正しくないようです。",
    [E_LONG]: "{max} 文字以内で入力してください。",
    [E_RATE_YOU]: "短時間に何度も送信されています。{minutes} 分後にもう一度お試しください。",
    [E_RATE_ALL]: "ただいまメッセージが集中しています。数分後にもう一度お試しください。",
    [E_NETWORK]: "送信できませんでした。接続を確認して、もう一度お試しください。",
    [E_SIGNIN]: "メッセージを送るには、サインインしてください。",
  },
  ko: {
    [P_TROUBLE]: "문제가 있나요? 메시지를 남겨 주시면 해결해 드리겠습니다.",
    [P_PAYMENT]: "결제했는데 크레딧이 들어오지 않았나요? 메시지를 남겨 주시면 해결해 드리겠습니다.",
    [S_TITLE]: "개발팀에 메시지 보내기",
    [S_LEDE]: "이 메시지는 앱을 만드는 팀에게 전달됩니다. 파일은 바뀌지 않으며 AI에게 주는 지시도 아닙니다. 저희 팀만 읽으며 사이트에 표시되지 않습니다.",
    [S_WHAT]: "무슨 일이 있었나요?",
    [S_PLACEHOLDER]: "팀에게: 무엇이 잘못됐는지, 어떤 버튼을 눌렀고 대신 무엇이 보였는지.",
    [S_EMAIL]: "이메일 (선택)",
    [S_EMAIL_HINT]: "답장을 드리기 위해서입니다. 비워 두면 익명으로 보낼 수 있습니다.",
    [S_EMAIL_HINT_SIGNED]: "이메일로 답장을 드리기 위해서입니다. 답장이 필요 없으면 비워 두세요.",
    [S_SENT_WITH]: "메시지와 함께 전송되는 정보",
    [S_ITEM_TEXT]: "메시지 내용과, 입력한 경우 이메일 주소.",
    [S_ITEM_APP]: "이 앱의 이름, 버전, 표시 언어, 현재 페이지, 브라우저 정보.",
    [S_ITEM_ERROR]: "오류에서 이 창을 연 경우 오류 코드.",
    [S_ITEM_ACCOUNT]: "로그인한 경우 계정 ID.",
    [S_ITEM_ACCOUNT_SIGNED]: "계정 ID.",
    [S_ITEM_TOPUP]: "확인을 위한 처리 중인 결제의 ID.",
    [S_ITEM_IP]: "IP 주소는 전송 횟수를 제한하는 데만 사용하며 메시지와 함께 저장하지 않습니다.",
    [S_ITEM_KEPT]: "메시지는 {days}일 동안 보관한 뒤 삭제합니다.",
    [S_CANCEL]: "취소",
    [S_SEND]: "보내기",
    [S_SENDING]: "보내는 중…",
    [S_THANKS]: "감사합니다. 메시지를 받았습니다.",
    [S_REF]: "접수 번호는 {ref}입니다.",
    [S_REPLY]: "{email}(으)로 답장을 드리겠습니다.",
    [S_NO_REPLY]: "이메일을 남기지 않아 답장을 드릴 수는 없지만, 문제는 확인하겠습니다.",
    [S_CLOSE]: "닫기",
    [S_SIGNIN_HELP]: "그래도 로그인할 수 없나요? {email}(으)로 이메일을 보내 주세요.",
    [S_SIGNIN_BUTTON]: "로그인",
    [E_EMPTY]: "무슨 일이 있었는지 적어 주세요.",
    [E_EMAIL]: "이메일 주소가 올바르지 않은 것 같습니다.",
    [E_LONG]: "{max}자 이내로 적어 주세요.",
    [E_RATE_YOU]: "방금 여러 번 보내셨습니다. {minutes}분 후에 다시 시도해 주세요.",
    [E_RATE_ALL]: "지금 메시지가 많이 몰리고 있습니다. 몇 분 후에 다시 시도해 주세요.",
    [E_NETWORK]: "메시지를 보내지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
    [E_SIGNIN]: "메시지를 보내려면 로그인해 주세요.",
  },
  de: {
    [P_TROUBLE]: "Probleme? Schreiben Sie uns eine Nachricht, wir kümmern uns darum.",
    [P_PAYMENT]: "Bezahlt, aber die Credits sind nicht angekommen? Schreiben Sie uns eine Nachricht, wir kümmern uns darum.",
    [S_TITLE]: "Nachricht an unser Team",
    [S_LEDE]: "Diese Nachricht geht an das Team, das diese App entwickelt. Sie verändert Ihre Datei nicht und ist keine Anweisung an die KI. Nur unser Team liest sie; sie wird nie auf der Website angezeigt.",
    [S_WHAT]: "Was ist passiert?",
    [S_PLACEHOLDER]: "An unser Team: was schiefging, welche Schaltfläche Sie gedrückt haben und was stattdessen zu sehen war.",
    [S_EMAIL]: "Ihre E-Mail-Adresse (optional)",
    [S_EMAIL_HINT]: "Damit wir antworten können. Leer lassen, um anonym zu schreiben.",
    [S_EMAIL_HINT_SIGNED]: "Damit wir per E-Mail antworten können. Leer lassen, wenn Sie keine Antwort brauchen.",
    [S_SENT_WITH]: "Was mit Ihrer Nachricht gesendet wird",
    [S_ITEM_TEXT]: "Ihre Nachricht und, falls angegeben, Ihre E-Mail-Adresse.",
    [S_ITEM_APP]: "Name, Version und Sprache dieser App, die aktuelle Seite und Ihr Browser.",
    [S_ITEM_ERROR]: "Der Fehlercode, falls dieses Fenster aus einer Fehlermeldung geöffnet wurde.",
    [S_ITEM_ACCOUNT]: "Ihre Konto-ID, falls Sie angemeldet sind.",
    [S_ITEM_ACCOUNT_SIGNED]: "Ihre Konto-ID.",
    [S_ITEM_TOPUP]: "Die ID Ihrer ausstehenden Zahlung, damit wir sie nachverfolgen können.",
    [S_ITEM_IP]: "Ihre IP-Adresse dient nur dazu, die Zahl der Nachrichten zu begrenzen. Sie wird nicht mit Ihrer Nachricht gespeichert.",
    [S_ITEM_KEPT]: "Nachrichten werden {days} Tage aufbewahrt und dann gelöscht.",
    [S_CANCEL]: "Abbrechen",
    [S_SEND]: "Nachricht senden",
    [S_SENDING]: "Wird gesendet…",
    [S_THANKS]: "Danke – Ihre Nachricht ist angekommen.",
    [S_REF]: "Ihre Referenz: {ref}.",
    [S_REPLY]: "Wir antworten an {email}.",
    [S_NO_REPLY]: "Sie haben keine E-Mail-Adresse angegeben, daher können wir nicht antworten – wir kümmern uns aber darum.",
    [S_CLOSE]: "Schließen",
    [S_SIGNIN_HELP]: "Die Anmeldung klappt immer noch nicht? Schreiben Sie uns an {email}.",
    [S_SIGNIN_BUTTON]: "Anmelden",
    [E_EMPTY]: "Bitte beschreiben Sie, was passiert ist.",
    [E_EMAIL]: "Diese E-Mail-Adresse scheint nicht zu stimmen.",
    [E_LONG]: "Bitte bleiben Sie unter {max} Zeichen.",
    [E_RATE_YOU]: "Sie haben gerade mehrere Nachrichten gesendet. Bitte versuchen Sie es in {minutes} Minuten erneut.",
    [E_RATE_ALL]: "Wir erhalten gerade sehr viele Nachrichten. Bitte versuchen Sie es in ein paar Minuten erneut.",
    [E_NETWORK]: "Ihre Nachricht konnte nicht gesendet werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
    [E_SIGNIN]: "Bitte melden Sie sich an, um uns eine Nachricht zu senden.",
  },
  es: {
    [P_TROUBLE]: "¿Tienes problemas? Déjanos un mensaje y lo resolveremos.",
    [P_PAYMENT]: "¿Pagaste y los créditos no han llegado? Déjanos un mensaje y lo resolveremos.",
    [S_TITLE]: "Escribe a nuestro equipo",
    [S_LEDE]: "Este mensaje llega al equipo que hace esta app. No cambia tu archivo y no es una instrucción para la IA. Solo lo lee nuestro equipo; nunca se muestra en el sitio.",
    [S_WHAT]: "¿Qué pasó?",
    [S_PLACEHOLDER]: "Para nuestro equipo: qué falló, qué botón pulsaste y qué apareció en su lugar.",
    [S_EMAIL]: "Tu correo electrónico (opcional)",
    [S_EMAIL_HINT]: "Para poder responderte. Déjalo vacío para escribir de forma anónima.",
    [S_EMAIL_HINT_SIGNED]: "Para poder responderte por correo. Déjalo vacío si no necesitas respuesta.",
    [S_SENT_WITH]: "Qué se envía con tu mensaje",
    [S_ITEM_TEXT]: "Tu mensaje y, si lo indicas, tu correo electrónico.",
    [S_ITEM_APP]: "El nombre, la versión y el idioma de esta app, la página en la que estás y tu navegador.",
    [S_ITEM_ERROR]: "El código de error, si abriste este cuadro desde un error.",
    [S_ITEM_ACCOUNT]: "El ID de tu cuenta, si has iniciado sesión.",
    [S_ITEM_ACCOUNT_SIGNED]: "El ID de tu cuenta.",
    [S_ITEM_TOPUP]: "El ID de tu pago pendiente, para poder rastrearlo.",
    [S_ITEM_IP]: "Tu dirección IP solo se usa para limitar cuántos mensajes se pueden enviar. No se guarda con tu mensaje.",
    [S_ITEM_KEPT]: "Los mensajes se guardan {days} días y luego se eliminan.",
    [S_CANCEL]: "Cancelar",
    [S_SEND]: "Enviar mensaje",
    [S_SENDING]: "Enviando…",
    [S_THANKS]: "Gracias, hemos recibido tu mensaje.",
    [S_REF]: "Tu referencia es {ref}.",
    [S_REPLY]: "Te responderemos a {email}.",
    [S_NO_REPLY]: "No dejaste un correo, así que no podremos responderte, pero lo revisaremos.",
    [S_CLOSE]: "Cerrar",
    [S_SIGNIN_HELP]: "¿Sigues sin poder iniciar sesión? Escríbenos a {email}.",
    [S_SIGNIN_BUTTON]: "Iniciar sesión",
    [E_EMPTY]: "Describe qué pasó.",
    [E_EMAIL]: "Esa dirección de correo no parece correcta.",
    [E_LONG]: "Escribe menos de {max} caracteres.",
    [E_RATE_YOU]: "Acabas de enviar varios mensajes. Inténtalo de nuevo en {minutes} minutos.",
    [E_RATE_ALL]: "Estamos recibiendo muchos mensajes ahora mismo. Inténtalo de nuevo en unos minutos.",
    [E_NETWORK]: "No se pudo enviar tu mensaje. Revisa tu conexión e inténtalo de nuevo.",
    [E_SIGNIN]: "Inicia sesión para enviarnos un mensaje.",
  },
  pt: {
    [P_TROUBLE]: "Está com problemas? Deixe uma mensagem e a gente resolve.",
    [P_PAYMENT]: "Pagou e os créditos não chegaram? Deixe uma mensagem e a gente resolve.",
    [S_TITLE]: "Escreva para nossa equipe",
    [S_LEDE]: "Esta mensagem vai para a equipe que faz este app. Ela não altera seu arquivo e não é uma instrução para a IA. Só a nossa equipe lê; nunca aparece no site.",
    [S_WHAT]: "O que aconteceu?",
    [S_PLACEHOLDER]: "Para a nossa equipe: o que deu errado, qual botão você apertou e o que apareceu no lugar.",
    [S_EMAIL]: "Seu e-mail (opcional)",
    [S_EMAIL_HINT]: "Para podermos responder. Deixe em branco para escrever anonimamente.",
    [S_EMAIL_HINT_SIGNED]: "Para podermos responder por e-mail. Deixe em branco se não precisar de resposta.",
    [S_SENT_WITH]: "O que é enviado com a sua mensagem",
    [S_ITEM_TEXT]: "Sua mensagem e, se você informar, seu e-mail.",
    [S_ITEM_APP]: "O nome, a versão e o idioma deste app, a página em que você está e o seu navegador.",
    [S_ITEM_ERROR]: "O código do erro, se esta caixa foi aberta a partir de um erro.",
    [S_ITEM_ACCOUNT]: "O ID da sua conta, se você estiver conectado.",
    [S_ITEM_ACCOUNT_SIGNED]: "O ID da sua conta.",
    [S_ITEM_TOPUP]: "O ID do seu pagamento pendente, para podermos rastreá-lo.",
    [S_ITEM_IP]: "Seu endereço IP é usado só para limitar quantas mensagens podem ser enviadas. Ele não é salvo com a sua mensagem.",
    [S_ITEM_KEPT]: "As mensagens são guardadas por {days} dias e depois excluídas.",
    [S_CANCEL]: "Cancelar",
    [S_SEND]: "Enviar mensagem",
    [S_SENDING]: "Enviando…",
    [S_THANKS]: "Obrigado, recebemos sua mensagem.",
    [S_REF]: "Sua referência é {ref}.",
    [S_REPLY]: "Vamos responder para {email}.",
    [S_NO_REPLY]: "Você não deixou um e-mail, então não poderemos responder, mas vamos analisar o problema.",
    [S_CLOSE]: "Fechar",
    [S_SIGNIN_HELP]: "Ainda não consegue entrar? Escreva para {email}.",
    [S_SIGNIN_BUTTON]: "Entrar",
    [E_EMPTY]: "Descreva o que aconteceu.",
    [E_EMAIL]: "Esse endereço de e-mail não parece correto.",
    [E_LONG]: "Escreva menos de {max} caracteres.",
    [E_RATE_YOU]: "Você acabou de enviar várias mensagens. Tente de novo em {minutes} minutos.",
    [E_RATE_ALL]: "Estamos recebendo muitas mensagens agora. Tente de novo em alguns minutos.",
    [E_NETWORK]: "Não foi possível enviar sua mensagem. Verifique sua conexão e tente de novo.",
    [E_SIGNIN]: "Entre na sua conta para nos enviar uma mensagem.",
  },
  fr: {
    [P_TROUBLE]: `Un problème${NB}? Laissez-nous un message, nous nous en occupons.`,
    [P_PAYMENT]: `Vous avez payé mais les crédits ne sont pas arrivés${NB}? Laissez-nous un message, nous nous en occupons.`,
    [S_TITLE]: "Écrire à notre équipe",
    [S_LEDE]: `Ce message est envoyé à l'équipe qui développe cette application. Il ne modifie pas votre fichier, et ce n'est pas une instruction pour l'IA. Seule notre équipe le lit${NB}; il n'est jamais affiché sur le site.`,
    [S_WHAT]: `Que s'est-il passé${NB}?`,
    [S_PLACEHOLDER]: `Pour notre équipe${NB}: ce qui n'a pas marché, sur quel bouton vous avez cliqué, et ce qui s'est affiché à la place.`,
    [S_EMAIL]: "Votre e-mail (facultatif)",
    [S_EMAIL_HINT]: "Pour que nous puissions vous répondre. Laissez vide pour écrire anonymement.",
    [S_EMAIL_HINT_SIGNED]: "Pour que nous puissions vous répondre par e-mail. Laissez vide si vous n'avez pas besoin de réponse.",
    [S_SENT_WITH]: "Ce qui est envoyé avec votre message",
    [S_ITEM_TEXT]: "Votre message et, si vous l'indiquez, votre e-mail.",
    [S_ITEM_APP]: "Le nom, la version et la langue de cette app, la page où vous êtes et votre navigateur.",
    [S_ITEM_ERROR]: "Le code d'erreur, si cette fenêtre a été ouverte depuis une erreur.",
    [S_ITEM_ACCOUNT]: "L'identifiant de votre compte, si vous êtes connecté.",
    [S_ITEM_ACCOUNT_SIGNED]: "L'identifiant de votre compte.",
    [S_ITEM_TOPUP]: "L'identifiant de votre paiement en attente, pour que nous puissions le retrouver.",
    [S_ITEM_IP]: "Votre adresse IP sert uniquement à limiter le nombre de messages envoyés. Elle n'est pas enregistrée avec votre message.",
    [S_ITEM_KEPT]: "Les messages sont conservés {days} jours, puis supprimés.",
    [S_CANCEL]: "Annuler",
    [S_SEND]: "Envoyer le message",
    [S_SENDING]: "Envoi…",
    [S_THANKS]: "Merci, nous avons bien reçu votre message.",
    [S_REF]: `Votre référence${NB}: {ref}.`,
    [S_REPLY]: "Nous vous répondrons à {email}.",
    [S_NO_REPLY]: "Vous n'avez pas laissé d'e-mail, nous ne pourrons donc pas vous répondre, mais nous allons examiner le problème.",
    [S_CLOSE]: "Fermer",
    [S_SIGNIN_HELP]: `Toujours impossible de vous connecter${NB}? Écrivez-nous à {email}.`,
    [S_SIGNIN_BUTTON]: "Se connecter",
    [E_EMPTY]: "Décrivez ce qui s'est passé.",
    [E_EMAIL]: "Cette adresse e-mail ne semble pas correcte.",
    [E_LONG]: "Restez sous {max} caractères.",
    [E_RATE_YOU]: "Vous venez d'envoyer plusieurs messages. Réessayez dans {minutes} minutes.",
    [E_RATE_ALL]: "Nous recevons beaucoup de messages en ce moment. Réessayez dans quelques minutes.",
    [E_NETWORK]: "Impossible d'envoyer votre message. Vérifiez votre connexion et réessayez.",
    [E_SIGNIN]: "Connectez-vous pour nous envoyer un message.",
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

// ---------------------------------------------------------- proof of work

const enc = typeof TextEncoder === "undefined" ? null : new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function leadingZeroBits(bytes) {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

/**
 * The server's `support::pow_input`, byte for byte — the Rust test pins the
 * same vector, so a change on either side fails a test.
 */
export async function proofInput(message, nonce) {
  return `openapps-support|${hex(await sha256(message))}|${nonce}`;
}

/** A nonce whose hash starts with `bits` zero bits. A fraction of a second at 14. */
export async function solveProof(message, bits = config.powBits) {
  if (!bits) return "0";
  const prefix = `openapps-support|${hex(await sha256(message))}|`;
  // Batched: one digest at a time spends most of its time waiting on the
  // promise, not hashing.
  const BATCH = 64;
  for (let start = 0; ; start += BATCH) {
    const nonces = Array.from({ length: BATCH }, (_, i) => (start + i).toString(16));
    const hashes = await Promise.all(nonces.map((n) => sha256(prefix + n)));
    const hit = hashes.findIndex((h) => leadingZeroBits(h) >= bits);
    if (hit >= 0) return nonces[hit];
  }
}

// ------------------------------------------------------------ who may send

let policy = null;

/**
 * The server's word on who may send: `{ requireSignin }`. Asked only when a
 * signed-out visitor opens the box, and then once per page. A server that
 * does not say, cannot be reached or takes over four seconds is taken as
 * welcoming signed-out visitors — the server still decides on send.
 */
export function supportPolicy() {
  policy ??= (async () => {
    await Promise.race([configured, new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (!config.baseUrl) return { requireSignin: false };
    try {
      const abort = typeof AbortController === "undefined" ? null : new AbortController();
      const timer = abort && setTimeout(() => abort.abort(), 4000);
      const res = await fetch(`${config.baseUrl}/v1/auth/methods`, abort ? { signal: abort.signal } : {});
      if (timer) clearTimeout(timer);
      const body = res.ok ? await res.json() : null;
      return { requireSignin: body?.support?.require_signin === true };
    } catch {
      return { requireSignin: false };
    }
  })();
  return policy;
}

let sessionCheck = null;

/**
 * Whether someone is signed in, asked when the box is opened and kept until
 * refreshSupport(). The hosts answer a signed-out visitor from local storage,
 * without a request.
 */
function signedInNow() {
  sessionCheck ??= (async () => {
    await configured;
    return Boolean(await accessToken());
  })();
  return sessionCheck;
}

const live = new Set();

/**
 * Call after a sign-in or a sign-out: the next opening asks again who is
 * there, and a box that is open now redraws for the new answer.
 */
export function refreshSupport() {
  sessionCheck = null;
  for (const box of live) box.refreshAccess();
}

// ------------------------------------------------------------- transport

/** Same loose rule as the server: one @, a dot in the domain, no spaces. */
export function plausibleEmail(value) {
  const v = String(value || "").trim();
  if (!v) return true;
  return v.length <= 254 && /^[^\s@<>()[\],;:"\\]{1,64}@[^\s@.<>]+(\.[^\s@.<>]+)+$/u.test(v);
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
    const res = await fetch(`${config.baseUrl}/v1/payments/topups`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const pending = (body?.topups ?? []).find((t) => t?.status === "pending");
    return pending?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Send one message. Resolves `{ ok: true, ref }` or `{ ok: false, code,
 * minutes?, scope? }`; never throws, so the form always has something to say.
 */
export async function sendSupportMessage({ message, email, context, errorCode, topupId }) {
  await Promise.race([configured, new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (!config.baseUrl) return { ok: false, code: "network" };
  const token = await accessToken();
  let topup = topupId || null;
  if (!topup && context === "payment") topup = await findPendingTopup(token);
  const body = {
    message,
    email: email || undefined,
    context: context || "general",
    page: typeof location === "undefined" ? undefined : location.origin + location.pathname,
    product: config.product || undefined,
    app_version: config.appVersion || undefined,
    error_code: errorCode || undefined,
    locale: pageLocale(),
    topup_id: topup || undefined,
  };
  let bits = config.powBits;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      const nonce = await solveProof(message, bits);
      res = await fetch(`${config.baseUrl}/v1/support/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ...body, pow: { nonce } }),
      });
    } catch {
      return { ok: false, code: "network" };
    }
    let reply = null;
    try {
      reply = await res.json();
    } catch {
      /* a non-JSON answer is handled as a failure below */
    }
    if (res.status === 202 && reply?.ref) return { ok: true, ref: reply.ref };
    const code = reply?.error?.code ?? "network";
    // The server asked for more work than this build does by default:
    // do that much and try once more.
    if (code === "proof_required" && attempt === 0 && Number(reply?.error?.bits) > bits) {
      bits = Number(reply.error.bits);
      continue;
    }
    if (code === "rate_limited") {
      const seconds = Number(res.headers.get("retry-after")) || 600;
      return {
        ok: false,
        code,
        scope: reply?.error?.scope ?? "you",
        minutes: Math.max(1, Math.ceil(seconds / 60)),
      };
    }
    return { ok: false, code };
  }
  return { ok: false, code: "network" };
}

// --------------------------------------------------------------- element

const ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

const STYLE = `
:host { display: block; font: inherit; color: var(--text-muted, GrayText); }
:host([hidden]), :host([data-empty]) { display: none !important; }
.signin-help a { color: inherit; text-underline-offset: 3px; }
.trigger[aria-busy="true"] { cursor: progress; opacity: .7; }
:host([variant="link"]) { display: inline-block; }
* { box-sizing: border-box; }
.trigger {
  display: inline-flex; align-items: flex-start; gap: 8px; text-align: start;
  font: inherit; font-size: var(--text-sm, 14px); line-height: 1.45;
  color: inherit; background: none; border: 0; padding: 4px 0; cursor: pointer;
}
.trigger svg { flex: none; margin-top: 2px; }
.trigger span { text-decoration: underline; text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); }
.trigger:hover { color: var(--text-strong, CanvasText); }
.trigger:hover span { text-decoration-color: currentColor; }
.trigger:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible {
  outline: 2px solid var(--border-focus, Highlight); outline-offset: 2px; border-radius: 4px;
}
:host([variant="link"]) .trigger { font-size: var(--text-xs, 12px); padding: 0; align-items: center; }
:host([variant="link"]) .trigger svg { margin-top: 0; width: 14px; height: 14px; }

dialog {
  color-scheme: inherit;
  width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px);
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
.lede, .hint, details, .count { color: var(--text-muted, GrayText); font-size: var(--text-sm, 14px); line-height: 1.45; }
.hint, .count { font-size: var(--text-xs, 12px); }
label { display: grid; gap: 6px; font-size: var(--text-sm, 14px); color: var(--text-strong, CanvasText); font-weight: 500; }
textarea, input {
  font: inherit; font-weight: 400; font-size: var(--text-base, 15px); color: var(--text-strong, CanvasText);
  background: var(--bg-page, Field); border: 1px solid var(--border-strong, color-mix(in srgb, CanvasText 30%, transparent));
  border-radius: var(--radius-md, 8px); padding: 9px 11px; width: 100%;
}
textarea { min-height: 120px; resize: vertical; line-height: 1.45; }
.row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
details summary { cursor: pointer; color: var(--text-body, CanvasText); }
details ul { margin: 8px 0 0; padding-inline-start: 18px; display: grid; gap: 4px; }
.trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.error {
  color: var(--danger-fg, #b3261e); background: var(--danger-bg, color-mix(in srgb, #b3261e 10%, transparent));
  border-radius: var(--radius-md, 8px); padding: 8px 10px; font-size: var(--text-sm, 14px);
}
.actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.btn {
  font: inherit; font-size: var(--text-sm, 14px); font-weight: 500; min-height: var(--control-h-md, 36px);
  padding: 0 16px; border-radius: var(--radius-md, 8px); cursor: pointer;
  border: 1px solid var(--border-strong, color-mix(in srgb, CanvasText 30%, transparent));
  background: var(--surface-card, Canvas); color: var(--text-strong, CanvasText);
}
/* A host whose primary action is not the suite green (OpenPixels draws it
   with the inverse pair) sets --support-primary-bg / -fg on the element. */
.btn.primary {
  background: var(--support-primary-bg, var(--brand, #00c896));
  color: var(--support-primary-fg, var(--brand-contrast, #020202)); border-color: transparent;
}
.btn:disabled { opacity: .6; cursor: progress; }
.ref { font-family: var(--font-mono, ui-monospace, monospace); color: var(--text-strong, CanvasText); }
@media (pointer: coarse) { .btn { min-height: 44px; } }
`;

let uid = 0;
const drafts = new Map();

export class OpenAppsSupportElement extends (typeof HTMLElement === "undefined" ? class {} : HTMLElement) {
  static observedAttributes = ["context", "error-code", "topup-id", "variant", "auto"];

  #root = null;
  #triggerBox = null;
  #langObserver = null;
  #pendingTopup = null;
  #opts = null;
  #state = "form"; // form | sending | done | signin
  #error = "";
  #result = null;
  #signedIn = false;
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
    this.#langObserver = new MutationObserver(() => this.#rerender());
    this.#langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    if (this.getAttribute("auto") === "pending-topup") void this.#checkPendingTopup();
  }

  disconnectedCallback() {
    live.delete(this);
    this.#langObserver?.disconnect();
  }

  /**
   * After a sign-in or sign-out: an open box redraws for whoever is there now
   * (the form for a new session; the sign-in prompt if the session ended and
   * signed-out visitors may not write).
   */
  async refreshAccess() {
    const dialog = this.#root?.querySelector("dialog");
    if (!dialog?.open || this.#state === "sending" || this.#state === "done") return;
    const state = await this.#gate();
    if (dialog.open && this.#state !== "sending" && this.#state !== "done") {
      this.#state = state;
      this.#renderDialog(dialog);
    }
  }

  /** "form", or "signin" when a signed-out visitor may not write here. */
  async #gate() {
    this.#signedIn = await signedInNow();
    if (this.#signedIn) return "form";
    const { requireSignin } = await supportPolicy();
    return requireSignin ? "signin" : "form";
  }

  attributeChangedCallback() {
    if (this.#root) this.#renderTrigger();
  }

  get #locale() {
    return pageLocale();
  }

  get #context() {
    return this.#opts?.context ?? this.getAttribute("context") ?? "general";
  }

  async #checkPendingTopup() {
    this.setAttribute("data-empty", "");
    await configured;
    const id = await findPendingTopup(await accessToken());
    this.#pendingTopup = id;
    if (id) this.removeAttribute("data-empty");
    this.#renderTrigger();
  }

  #rerender() {
    this.#renderTrigger();
    const dialog = this.#root?.querySelector("dialog");
    if (dialog?.open) this.#renderDialog(dialog);
  }

  #renderTrigger() {
    const L = this.#locale;
    const variant = this.getAttribute("variant") ?? "prompt";
    const payment = this.#context === "payment";
    const label =
      variant === "link" ? t(L, S_TITLE) : t(L, payment ? P_PAYMENT : P_TROUBLE);
    this.#triggerBox.textContent = "";
    if (variant !== "none") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "trigger";
      button.setAttribute("part", "trigger");
      button.innerHTML = ICON; // a constant, never data
      const span = document.createElement("span");
      span.textContent = label;
      button.appendChild(span);
      button.addEventListener("click", () => this.open());
      this.#triggerBox.appendChild(button);
    }
  }

  /**
   * Open the box. `opts` overrides the attributes for this opening. Who is
   * asking is worked out first (see WHO MAY WRITE), which for a signed-out
   * visitor is the first and only request the box makes before Send.
   */
  async open(opts = null) {
    if (!this.#root) this.connectedCallback();
    const run = ++this.#openRun;
    const trigger = this.#triggerBox?.querySelector(".trigger");
    trigger?.setAttribute("aria-busy", "true");
    let state = "form";
    try {
      state = await this.#gate();
    } catch {
      // Whatever went wrong, the switch-off behaviour: the form.
    } finally {
      trigger?.removeAttribute("aria-busy");
    }
    if (run !== this.#openRun) return;
    this.#opts = opts;
    this.#state = state;
    this.#error = "";
    this.#result = null;
    let dialog = this.#root.querySelector("dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.addEventListener("close", () => {
        if (this.#state === "done") drafts.delete(this.#draftKey());
      });
      this.#root.appendChild(dialog);
    }
    this.#renderDialog(dialog);
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    (dialog.querySelector("textarea") ?? dialog.querySelector(".btn.primary"))?.focus();
  }

  #draftKey() {
    return `${this.#context}`;
  }

  #renderDialog(dialog) {
    const L = this.#locale;
    const id = `oa-support-${++uid}`;
    dialog.textContent = "";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.setAttribute("lang", L);
    const body = el("div", { class: "body" });
    dialog.appendChild(body);
    body.appendChild(el("h2", { id: `${id}-title` }, t(L, this.#state === "done" ? S_THANKS : S_TITLE)));

    if (this.#state === "done") {
      const { ref, email } = this.#result;
      const refLine = el("p", {});
      const [before, after] = t(L, S_REF).split("{ref}");
      refLine.append(before ?? "", el("span", { class: "ref", "data-testid": "support-ref" }, ref), after ?? "");
      body.appendChild(refLine);
      body.appendChild(el("p", { class: "lede" }, email ? t(L, S_REPLY, { email }) : t(L, S_NO_REPLY)));
      const actions = el("div", { class: "actions" });
      const close = el("button", { type: "button", class: "btn primary" }, t(L, S_CLOSE));
      close.addEventListener("click", () => dialog.close());
      actions.appendChild(close);
      body.appendChild(actions);
      queueMicrotask(() => close.focus());
      return;
    }

    if (this.#state === "signin") {
      // Only signed-in visitors may write here, and nobody is: say so, and
      // offer the product's own sign-in rather than a form the server would
      // refuse.
      body.setAttribute("data-testid", "support-signin-needed");
      body.appendChild(el("p", { class: "lede" }, t(L, E_SIGNIN)));
      if (this.#context === "signin" && config.contactEmail) {
        // A sign-in has just failed here, so the address that needs no
        // session is offered as well.
        const help = el("p", { class: "lede signin-help", "data-testid": "support-signin-help" });
        const [before, after] = t(L, S_SIGNIN_HELP).split("{email}");
        const link = el("a", { href: `mailto:${config.contactEmail}` }, config.contactEmail);
        help.append(before ?? "", link, after ?? "");
        body.appendChild(help);
      }
      const actions = el("div", { class: "actions" });
      const cancel = el("button", { type: "button", class: "btn" }, t(L, S_CANCEL));
      cancel.addEventListener("click", () => dialog.close());
      actions.appendChild(cancel);
      if (typeof config.signIn === "function") {
        const go = el("button", { type: "button", class: "btn primary", "data-testid": "support-signin" }, t(L, S_SIGNIN_BUTTON));
        go.addEventListener("click", () => {
          dialog.close();
          // After this click has finished: a host menu that closes on any
          // click outside itself would otherwise close again at once.
          setTimeout(() => {
            try {
              config.signIn();
            } catch {
              /* the host's sign-in is its own business */
            }
          }, 0);
        });
        actions.appendChild(go);
      }
      body.appendChild(actions);
      return;
    }

    body.appendChild(el("p", { class: "lede" }, t(L, S_LEDE)));
    const form = el("form", { novalidate: "" });
    form.style.display = "grid";
    form.style.gap = "14px";
    body.appendChild(form);

    const draft = drafts.get(this.#draftKey()) ?? { message: "", email: "" };
    const textarea = el("textarea", {
      name: "message",
      maxlength: String(MAX_CHARS),
      rows: "5",
      placeholder: t(L, S_PLACEHOLDER),
      required: "",
    });
    textarea.value = draft.message;
    const count = el("span", { class: "count", "aria-live": "off" }, `${draft.message.length} / ${MAX_CHARS}`);
    const whatLabel = el("label", {}, t(L, S_WHAT));
    whatLabel.appendChild(textarea);
    form.appendChild(whatLabel);
    const counterRow = el("div", { class: "row" });
    counterRow.appendChild(el("span", {}));
    counterRow.appendChild(count);
    form.appendChild(counterRow);
    counterRow.style.marginTop = "-10px";

    const email = el("input", { name: "email", type: "email", autocomplete: "email", inputmode: "email" });
    email.value = draft.email;
    const emailLabel = el("label", {}, t(L, S_EMAIL));
    emailLabel.appendChild(email);
    emailLabel.appendChild(el("span", { class: "hint" }, t(L, this.#signedIn ? S_EMAIL_HINT_SIGNED : S_EMAIL_HINT)));
    form.appendChild(emailLabel);

    // A person never sees or reaches this; a form-filling bot fills it.
    const trap = el("div", { class: "trap", "aria-hidden": "true" });
    const trapInput = el("input", { name: "website", type: "text", tabindex: "-1", autocomplete: "off" });
    const trapLabel = el("label", {}, "Website");
    trapLabel.appendChild(trapInput);
    trap.appendChild(trapLabel);
    form.appendChild(trap);

    const details = el("details", {});
    details.appendChild(el("summary", {}, t(L, S_SENT_WITH)));
    const list = el("ul", {});
    const items = [S_ITEM_TEXT, S_ITEM_APP, S_ITEM_ERROR, this.#signedIn ? S_ITEM_ACCOUNT_SIGNED : S_ITEM_ACCOUNT];
    if (this.#context === "payment") items.push(S_ITEM_TOPUP);
    items.push(S_ITEM_IP);
    for (const item of items) list.appendChild(el("li", {}, t(L, item)));
    list.appendChild(el("li", {}, t(L, S_ITEM_KEPT, { days: RETENTION_DAYS })));
    details.appendChild(list);
    form.appendChild(details);

    if (this.#error) form.appendChild(el("p", { class: "error", role: "alert" }, this.#error));

    const actions = el("div", { class: "actions" });
    const cancel = el("button", { type: "button", class: "btn" }, t(L, S_CANCEL));
    cancel.addEventListener("click", () => dialog.close());
    const sending = this.#state === "sending";
    const send = el("button", { type: "submit", class: "btn primary" }, t(L, sending ? S_SENDING : S_SEND));
    if (sending) {
      send.disabled = true;
      textarea.readOnly = true;
      email.readOnly = true;
    }
    actions.append(cancel, send);
    form.appendChild(actions);

    const keep = () => {
      drafts.set(this.#draftKey(), { message: textarea.value, email: email.value });
      count.textContent = `${textarea.value.length} / ${MAX_CHARS}`;
    };
    textarea.addEventListener("input", keep);
    email.addEventListener("input", keep);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (this.#state === "sending") return;
      keep();
      const message = textarea.value.trim();
      const address = email.value.trim();
      // A filled trap is sent anyway: the server answers it convincingly
      // and stores nothing, so a bot learns nothing from the page either.
      if (!trapInput.value) {
        if ([...message].filter((c) => !/\s/.test(c)).length < 2) return this.#fail(dialog, t(L, E_EMPTY));
        if ([...message].length > MAX_CHARS) return this.#fail(dialog, t(L, E_LONG, { max: MAX_CHARS }));
        if (!plausibleEmail(address)) return this.#fail(dialog, t(L, E_EMAIL));
      }
      this.#state = "sending";
      this.#error = "";
      this.#renderDialog(dialog);
      const result = trapInput.value
        ? await honeypotSend(message, trapInput.value)
        : await sendSupportMessage({
            message,
            email: address,
            context: this.#context,
            errorCode: this.#opts?.errorCode ?? this.getAttribute("error-code"),
            topupId: this.#opts?.topupId ?? this.getAttribute("topup-id") ?? this.#pendingTopup,
          });
      if (result.ok) {
        this.#state = "done";
        this.#result = { ref: result.ref, email: address };
        drafts.delete(this.#draftKey());
        this.dispatchEvent(
          new CustomEvent("openapps-support-sent", { detail: { ref: result.ref }, bubbles: true, composed: true }),
        );
        this.#renderDialog(dialog);
        return;
      }
      if (result.code === "signin_required") {
        // The session ended under the page: say so, with the way back in.
        this.#state = "signin";
        this.#renderDialog(dialog);
        return;
      }
      this.#state = "form";
      const messages = {
        message_empty: t(L, E_EMPTY),
        invalid_email: t(L, E_EMAIL),
        message_too_long: t(L, E_LONG, { max: MAX_CHARS }),
        signin_required: t(L, E_SIGNIN),
        rate_limited:
          result.scope === "everyone" ? t(L, E_RATE_ALL) : t(L, E_RATE_YOU, { minutes: result.minutes ?? 10 }),
      };
      this.#fail(dialog, messages[result.code] ?? t(L, E_NETWORK));
    });
  }

  #fail(dialog, message) {
    this.#error = message;
    this.#renderDialog(dialog);
    dialog.querySelector(".error")?.scrollIntoView?.({ block: "nearest" });
  }
}

/** The trap path: send what a bot filled, so the server can discard it. */
async function honeypotSend(message, website) {
  try {
    const res = await fetch(`${config.baseUrl}/v1/support/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, website }),
    });
    const reply = await res.json().catch(() => null);
    return reply?.ref ? { ok: true, ref: reply.ref } : { ok: false, code: "network" };
  } catch {
    return { ok: false, code: "network" };
  }
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
 * Open the box from code — from a catch block, say — without placing an
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
