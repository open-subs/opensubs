<?xml version="1.0" encoding="UTF-8"?>
<!--
  A readable view of sitemap.xml.

  Not decoration. Since the sitemap started carrying hreflang alternates
  (APP-49's translated pages), Chromium stops applying its built-in XML
  pretty-printer to it: the document contains elements in the XHTML
  namespace, so Blink treats it as renderable markup and lays the text out
  instead. The result is every URL, date and priority run together in one
  paragraph — which is what APP-69 reported.

  The file itself was always valid, and Bing accepted it. What was missing
  was any instruction for how to *display* it, so the browser fell back on
  a default that this shape of sitemap does not qualify for. This supplies
  one, which makes the view deliberate rather than dependent on a default,
  and works in every browser rather than in the ones that pretty-print.

  Crawlers ignore the stylesheet: the xml-stylesheet processing
  instruction is not part of the sitemap schema and no parser reads it.

  XSLT 1.0 on purpose — it is what browsers implement, and 2.0/3.0 is not
  available in any of them.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="sm xhtml">

<xsl:output method="html" indent="yes" encoding="UTF-8"
  doctype-system="about:legacy-compat" />

<xsl:template match="/">
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Sitemap — OpenSubs</title>
<style>
  :root {
    --ground: #f7f7f5;
    --card: #ffffff;
    --ink: #16181c;
    --muted: #5f6672;
    --rule: #e3e5e9;
    --rule-soft: #eef0f3;
    --accent: #ff8c42;
    --accent-soft: #fff1e6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #111214;
      --card: #17181b;
      --ink: #f1f2f4;
      --muted: #9aa1ac;
      --rule: #292b30;
      --rule-soft: #202226;
      --accent: #ff9c5c;
      --accent-soft: #2a1d14;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 20px 72px; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .brand { font-weight: 600; font-size: 17px; letter-spacing: -0.01em; text-decoration: none; color: inherit; }
  .brand .muted { color: var(--muted); font-weight: 500; }
  .brand .dot { color: var(--accent); }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 22px 0 6px; }
  .lede { color: var(--muted); margin: 0 0 4px; max-width: 62ch; }
  .count {
    display: inline-block; margin: 18px 0 6px; padding: 3px 10px;
    border-radius: 999px; background: var(--accent-soft); color: var(--accent);
    font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em;
  }
  .scroll { overflow-x: auto; border: 1px solid var(--rule); border-radius: 10px; background: var(--card); }
  table { border-collapse: collapse; width: 100%; min-width: 720px; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  thead th {
    position: sticky; top: 0; background: var(--card);
    font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--rule);
  }
  tbody tr:last-child td { border-bottom: 0; }
  td a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--rule); word-break: break-all; }
  td a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  .num { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: var(--muted); }
  .langs { font-size: 12px; color: var(--muted); }
  .langs code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--rule-soft); border-radius: 4px; padding: 1px 4px; margin-right: 3px;
    display: inline-block; margin-bottom: 2px;
  }
  footer { margin-top: 22px; color: var(--muted); font-size: 13px; }
  footer a { color: inherit; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="/"><span class="muted">Open</span>Subs<span class="dot">.</span></a>
  </header>

  <h1>Sitemap</h1>
  <p class="lede">
    This is the list of pages OpenSubs asks search engines to index. The file a
    crawler reads is XML; this page is the same file with a stylesheet applied
    so a person can read it too.
  </p>
  <p class="count"><xsl:value-of select="count(sm:urlset/sm:url)" /> URLs</p>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>URL</th>
          <th>Languages</th>
          <th>Last modified</th>
          <th>Changes</th>
          <th>Priority</th>
        </tr>
      </thead>
      <tbody>
        <xsl:for-each select="sm:urlset/sm:url">
          <tr>
            <td>
              <a><xsl:attribute name="href"><xsl:value-of select="sm:loc" /></xsl:attribute>
                <xsl:value-of select="sm:loc" /></a>
            </td>
            <td class="langs">
              <xsl:choose>
                <xsl:when test="xhtml:link">
                  <xsl:for-each select="xhtml:link">
                    <code><xsl:value-of select="@hreflang" /></code>
                  </xsl:for-each>
                </xsl:when>
                <xsl:otherwise>—</xsl:otherwise>
              </xsl:choose>
            </td>
            <td class="num"><xsl:value-of select="sm:lastmod" /></td>
            <td class="num"><xsl:value-of select="sm:changefreq" /></td>
            <td class="num"><xsl:value-of select="sm:priority" /></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </div>

  <footer>
    Generated by <code>apps/web/scripts/build-locale-pages.py</code>.
    Every page is listed once per language, and each row names the alternates
    declared for it. <a href="/">Back to opensubs.app</a>
  </footer>
</div>
</body>
</html>
</xsl:template>

</xsl:stylesheet>
