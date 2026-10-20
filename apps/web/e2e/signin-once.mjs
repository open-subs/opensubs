// Back from a redirect sign-in, the page spends the `#code=` exactly once,
// and a card checkout comes back to this page.
//
//   npm run build && node e2e/signin-once.mjs
//
// The accounts server is faked with Playwright routes: nothing here signs in
// for real or reaches a payment provider. What it measures is what the page
// sends.
//
// Why it exists: every Google sign-in on opensubs.app sent two exchanges for
// one code, and the server answered the second with a 401. The page built a
// second accounts client after the first had started exchanging, and the
// elements, now on the second client, read the same code from the address
// bar and spent it again. A checkout also asked to land on the accounts
// server's own confirmation page instead of coming back here.
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

const browser = await chromium.launch();
const page = await browser.newPage();
const exchanges = [];
const checkouts = [];
const json = (route, status, body) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
    body: JSON.stringify(body),
  });

await page.route("https://auth.opensubs.app/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return json(route, 204, {});
  const url = new URL(req.url());
  switch (url.pathname) {
    case "/v1/auth/oidc/exchange": {
      exchanges.push(req.postDataJSON()?.code);
      // A code is good once, as on the real server.
      return exchanges.length === 1
        ? json(route, 200, { access_token: "test-access", refresh_token: "test-refresh" })
        : json(route, 401, { error: "unauthorized", message: "code already used" });
    }
    case "/v1/me":
      return json(route, 200, { user_id: "u-test", identities: [] });
    case "/v1/auth/methods":
      return json(route, 200, { methods: ["google"] });
    case "/v1/payments/packages":
      return json(route, 200, {
        packages: [{ id: "p1", credits: 1000, usd_price: "5.00", label: "1,000 credits" }],
        rails: { stripe: true },
      });
    case "/v1/payments/stripe/checkout":
      checkouts.push(req.postDataJSON());
      return json(route, 200, { checkout_url: `${base}/stripe-stand-in`, topup_id: "t1" });
    default:
      if (url.pathname.includes("balance")) return json(route, 200, { balance: 0, credits: 0 });
      return json(route, 200, {});
  }
});

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failed++;
};

await page.goto(`${base}/#code=test-code`);
// The exchange happens at startup; give a second one time to happen too.
await page.waitForTimeout(8000);
check(exchanges.length === 1, `the code is exchanged once (exchanged ${exchanges.length} time(s))`);
check(!(await page.evaluate(() => location.hash.includes("code="))), "the code is gone from the address bar");

// Buy. The page only renders <openapps-buy> beside a priced action, which
// needs a finished transcript, so this places one with the attribute value
// the app passes on the web ("" -- the built bundle sets
// `inNativeShell() ? "none" : ""`) and checks where the checkout asks to
// come back to.
await page.evaluate(() => {
  document.addEventListener("openapps-checkout", (e) => e.preventDefault(), true);
  const buy = document.createElement("openapps-buy");
  buy.setAttribute("return-to", "");
  document.body.append(buy);
});
const buy = page.locator("openapps-buy").last();
await buy.getByRole("button", { name: /1,000 credits/ }).click();
await buy.getByRole("button", { name: "Pay by card" }).click();
await page.waitForTimeout(1500);
const back = checkouts[0]?.return_to ?? "";
check(back.startsWith(base), `a card checkout comes back to this page (return_to ${back || "absent"})`);

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
