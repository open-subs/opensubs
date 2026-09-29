/**
 * Change language without leaving the page, while there is work open.
 *
 * The site's language links -- the globe menu and the row in the footer --
 * are real `<a hreflang>` links to `/de`, `/ja` and so on, and they have to
 * stay real links: they are what a crawler follows, and what someone
 * copies to send a German page to a German reader. But following one is a
 * full-page navigation, and a navigation destroys the tab. The video is a
 * `File` from a picker, which cannot survive that (see workinprogress.ts),
 * so switching language after generating subtitles dropped the reader back
 * on "Start with a video".
 *
 * So while the app is working, a click on one of those links is taken over:
 * the app's own locale changes in place (every `t()` re-renders), the URL
 * becomes the one the link named, and the page's own chrome -- the header,
 * the footer, the hidden marketing sections -- is swapped for the target
 * document's, so the page is not left bilingual. Anything that goes wrong
 * fetching that document falls back to the plain navigation it would have
 * been. With no work open the link is left alone.
 */
import { setLocale } from "./index.svelte";

export function keepWorkAcrossLanguageLinks(isWorking: () => boolean): () => void {
  const onClick = async (event: MouseEvent) => {
    if (!isWorking() || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a[hreflang]");
    if (!link || link.closest("#app")) return;
    const code = link.hreflang;
    const alternate = document.querySelector<HTMLLinkElement>(
      `link[rel="alternate"][hreflang="${CSS.escape(code)}"]`,
    );
    // Only this page's own translations; a link to some other page is a
    // real navigation and the reader asked for it.
    // Compared by path: the ring names the production host, which is not
    // the host on a staging copy or a local build.
    if (!alternate || new URL(alternate.href).pathname !== new URL(link.href).pathname) return;
    event.preventDefault();
    link.closest("details")?.removeAttribute("open");

    let next: Document;
    try {
      const res = await fetch(link.href, { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      next = new DOMParser().parseFromString(await res.text(), "text/html");
    } catch {
      location.href = link.href;
      return;
    }
    setLocale(code);
    swapChrome(document.body, next.body);
    document.title = next.title;
    for (const sel of ['meta[name="description"]', 'link[rel="canonical"]']) {
      const mine = document.head.querySelector(sel);
      const theirs = next.head.querySelector(sel);
      if (mine && theirs) mine.replaceWith(document.importNode(theirs, true));
    }
    history.replaceState(history.state, "", link.href + location.hash);
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

/**
 * Replace everything in `mine` with its counterpart in `theirs`, except
 * the branch that holds the running app, which is descended into instead.
 * Pairs children by position and tag; where the two documents disagree on
 * shape, that element is left as it is rather than guessed at.
 */
function swapChrome(mine: Element, theirs: Element): void {
  const a = [...mine.children];
  const b = [...theirs.children];
  if (a.length !== b.length) return;
  a.forEach((el, i) => {
    const other = b[i];
    if (el.tagName !== other.tagName || el.tagName === "SCRIPT") return;
    if (el.id === "app") return;
    if (el.querySelector("#app")) swapChrome(el, other);
    else el.replaceWith(document.importNode(other, true));
  });
}
