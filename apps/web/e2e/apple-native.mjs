// "Continue with Apple" in the iOS app is Apple's own sheet, and the page
// hands what it returns to the accounts server unchanged.
//
//   npm run build && node e2e/apple-native.mjs
//
// The iOS shell and the accounts server are both faked: the shell by a
// `window.Capacitor` that answers like the native bridge (the same object
// Capacitor's own bridge script installs in the app), the server by
// Playwright routes. Nothing signs in for real. What is measured is what the
// page offers, what it asks the sheet for, and what it sends the server:
//
//   - in the shell, with the server offering `apple_native`, the Apple button
//     is there and first, even though the web flow (`apple`) is off;
//   - pressing it asks the sheet for SHA-256(challenge nonce), never
//     navigates, and posts the sheet's token and code to /v1/auth/verify under
//     that challenge;
//   - closing the sheet sends nothing and shows no error;
//   - in a browser, the same server reply shows no Apple button.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = resolve(fileURLToPath(new URL(".", import.meta.url)), "../dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const NONCE = "server-issued-nonce-123";
const json = (route, status, body) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
    body: JSON.stringify(body),
  });

/** A page on the built app, with a faked server and (optionally) shell. */
async function open(browser, { shell, sheetAnswer }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = { verify: [], challenges: [], starts: [], sheet: [] };
  await page.route("**/script.js", (r) => r.abort());
  await page.route("**/api/send", (r) => r.abort());
  await page.route("https://auth.opensubs.app/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return json(route, 204, {});
    const url = new URL(req.url());
    switch (url.pathname) {
      case "/v1/auth/methods":
        // What auth.opensubs.app answers once native Apple is on: the web
        // flow off on this host, the sheet on.
        return json(route, 200, {
          methods: { apple: false, apple_native: true, google: true, nostr: true },
        });
      case "/v1/auth/challenge":
        seen.challenges.push(req.postDataJSON());
        return json(route, 200, { challenge_id: "ch-1", message: NONCE, expires_at: 0 });
      case "/v1/auth/verify":
        seen.verify.push(req.postDataJSON());
        return json(route, 200, {
          access_token: "test-access",
          refresh_token: "test-refresh",
          user: { id: "u-test" },
          is_new: true,
        });
      case "/v1/me":
        return json(route, 200, {
          user_id: "u-test",
          linked_accounts: [{ namespace: "apple", caip10: "apple:x", label: "Apple ID" }],
        });
      default:
        if (url.pathname.includes("/oidc/")) seen.starts.push(url.pathname);
        if (url.pathname.includes("balance")) return json(route, 200, { balance: 0, credits: 0 });
        return json(route, 200, {});
    }
  });
  if (shell) {
    await page.exposeFunction("__sheet", (plugin, method, options) => {
      seen.sheet.push({ plugin, method, options });
      return sheetAnswer;
    });
    await page.addInitScript(() => {
      // The native bridge's surface, as @capacitor/core reads it: the
      // platform from WebKit's message handler, the plugins from the
      // headers the shell injects, and promise calls through nativePromise.
      window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
      window.Capacitor = {
        PluginHeaders: [
          { name: "OpenSubsAuth", methods: [{ name: "signInWithApple", rtype: "promise" }] },
        ],
        nativePromise: (plugin, method, options) => window.__sheet(plugin, method, options),
        nativeCallback: () => "cb",
      };
    });
  }
  await page.goto(`${base}/`);
  await page.waitForTimeout(2500);
  // The header's sign-in menu, opened as a tap on "Sign in" would.
  await page.evaluate(() => document.querySelector(".nav-panel")?.classList.add("open"));
  return { context, page, seen };
}

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();

// --- in the iOS shell -------------------------------------------------------
{
  const { context, page, seen } = await open(browser, {
    shell: true,
    sheetAnswer: { status: "signed-in", identityToken: "apple.identity.token", authorizationCode: "sheet-code" },
  });
  const login = page.locator("openapps-login").first();
  const buttons = await login.locator("button").allInnerTexts();
  check(/Continue with Apple/.test(buttons[0] ?? ""), `Apple is the first button in the shell (${JSON.stringify(buttons.slice(0, 3))})`);
  await login.getByRole("button", { name: /Continue with Apple/ }).click({ force: true });
  await page.waitForTimeout(1500);

  const sheet = seen.sheet[0];
  const want = createHash("sha256").update(NONCE).digest("hex");
  check(sheet?.plugin === "OpenSubsAuth" && sheet?.method === "signInWithApple", "the press asks the shell's sheet");
  check(sheet?.options?.nonce === want, `the sheet is given SHA-256 of the server's nonce (${sheet?.options?.nonce})`);
  check(seen.challenges[0]?.namespace === "apple_native", "the challenge is an apple_native one");
  const v = seen.verify[0];
  check(
    v?.challenge_id === "ch-1" &&
      v?.proof?.type === "apple_id_token" &&
      v?.proof?.identity_token === "apple.identity.token" &&
      v?.proof?.authorization_code === "sheet-code",
    `the sheet's token and code go to /v1/auth/verify (${JSON.stringify(v)})`,
  );
  check(seen.starts.length === 0, `nothing navigates to a redirect sign-in (${seen.starts.join(", ")})`);
  check(new URL(page.url()).origin === base, "the page stays where it was");
  const session = await page.evaluate(() => JSON.stringify(localStorage));
  check(session.includes("test-access"), "the session is kept like any other sign-in");
  await context.close();
}

// --- the sheet closed ---------------------------------------------------------
{
  const { context, page, seen } = await open(browser, { shell: true, sheetAnswer: { status: "cancelled" } });
  const login = page.locator("openapps-login").first();
  await login.getByRole("button", { name: /Continue with Apple/ }).click({ force: true });
  await page.waitForTimeout(1200);
  check(seen.sheet.length === 1, "a second press still opens the sheet");
  check(seen.verify.length === 0, "closing the sheet sends nothing to the server");
  const text = await login.evaluate((el) => el.shadowRoot?.textContent ?? "");
  check(!/error|failed/i.test(text), "and shows no error");
  await context.close();
}

// --- in a browser ---------------------------------------------------------------
{
  const { context, page } = await open(browser, { shell: false });
  const buttons = await page.locator("openapps-login").first().locator("button").allInnerTexts();
  check(!buttons.some((b) => /Apple/.test(b)), `no Apple button on the website (${JSON.stringify(buttons.slice(0, 3))})`);
  await context.close();
}

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
