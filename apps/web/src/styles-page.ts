// The /styles gallery's stylesheet, and nothing else.
//
// A module rather than a <link> so vite bundles the token imports and
// rewrites the font URLs inside them; a bare <link rel="stylesheet"> to a
// source file ships the @import chain unresolved and the fonts 404.
//
// Deliberately not `./app.css`: this page has no app on it, and pulling
// the product stylesheet in would pull the tool behind it -- on the one
// page whose job is to load fast and be crawled.
import "./styles-page.css";

// The language picker, in eleven lines rather than a bundle.
//
// Every other page mounts src/lib/LanguagePicker.svelte, which arrives
// with main.ts. This page must not: main.ts brings app.css and the tool
// behind it, on the page that exists to load fast and be crawled. So the
// <select> is written into the markup by scripts/build-styles-page.py and
// wired up here.
//
// Here rather than in an inline <script>, because the site's CSP is
// `script-src 'self'` -- an inline script is dropped silently, which is
// exactly how this shipped once and did nothing.
//
// The target URL comes off the page's own hreflang ring, so the control
// can only offer a document that scripts/build-locale-pages.py wrote.
const picker = document.querySelector<HTMLSelectElement>(".site-header .lang select");
if (picker) {
  picker.value = document.documentElement.lang || "en";
  picker.addEventListener("change", () => {
    const alt = document.querySelector<HTMLLinkElement>(
      `link[rel="alternate"][hreflang="${CSS.escape(picker.value)}"]`,
    );
    if (alt && alt.href !== location.href.split("#")[0]) location.href = alt.href;
  });
}
