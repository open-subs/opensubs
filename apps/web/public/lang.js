// The language picker on the privacy page.
//
// That page is a plain file in public/ -- no vite entry, no bundle, and
// deliberately so: a legal document should not depend on a build to be
// readable. It is still translated into eight languages, though, and a
// reader who lands on it from a search result needs the control here
// rather than one link away.
//
// A file rather than an inline <script>, because the site's CSP is
// `script-src 'self'` and an inline one is dropped without a word.
//
// The target URL is read off the page's own hreflang ring, which
// scripts/build-locale-pages.py writes, so this can only ever offer a
// document that exists. On a build without the ring it does nothing.
(function () {
  var select = document.querySelector("header .lang select");
  if (!select) return;
  select.value = document.documentElement.lang || "en";
  select.addEventListener("change", function () {
    var alt = document.querySelector(
      'link[rel="alternate"][hreflang="' + select.value.replace(/"/g, "") + '"]');
    if (alt && alt.href !== location.href.split("#")[0]) location.href = alt.href;
  });
})();
