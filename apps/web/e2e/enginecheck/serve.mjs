// Build the engine check, serve it, and print whatever runs it reports.
//
// The point of the fetch-based report is this script: a simulator or a
// phone on the same network opens the URL, and the verdict arrives here in
// a terminal rather than in a console nobody can read. Every run is
// appended to results.json, so a table of OS versions builds up instead of
// being retyped from memory.
//
//   node e2e/enginecheck/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, resolve, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const port = Number(process.argv[2] ?? 5180);

console.log("building the harness…");
execFileSync("npx", ["vite", "build", "--config", join(here, "vite.config.ts")],
  { cwd: web, stdio: "inherit" });

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".wav": "audio/wav", ".map": "application/json",
};

// Two roots: the harness build, then the app's public/ for the test clip.
// Kept separate rather than copied, so the clip under test is the same file
// every other test in this repo uses.
const roots = [join(here, "dist"), join(web, "public")];

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/report") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const report = JSON.parse(body);
    console.log(`\n=== ${report.verdict.toUpperCase()} ===`);
    console.log(report.ua);
    for (const line of report.log ?? []) console.log("  " + line);
    if (report.error) console.log("  error: " + report.error);
    await appendFile(join(here, "results.json"),
      JSON.stringify({ at: new Date().toISOString(), ...report }) + "\n");
    res.writeHead(204).end();
    return;
  }
  // Path traversal is not theoretical when the server is told the path by
  // whatever opened it; normalize first, then refuse anything that climbs.
  const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
  if (rel.includes("..")) { res.writeHead(403).end(); return; }
  const name = rel === "/" ? "/index.html" : rel;
  for (const root of roots) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      // ONNX Runtime uses threads only when the page is cross-origin
      // isolated. Sending these makes the harness match a real browser tab
      // on opensubs.app rather than the app shell, which cannot send them.
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-resource-policy": "cross-origin",
    });
    res.end(await readFile(path));
    return;
  }
  res.writeHead(404).end();
}).listen(port, "0.0.0.0", () => {
  console.log(`\nengine check on http://localhost:${port}/  (reports print here)`);
});
