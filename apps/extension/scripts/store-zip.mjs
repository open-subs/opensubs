#!/usr/bin/env node
// Zip a built extension for a store, and refuse a store zip that carries `key`.
//
//   node store-zip.mjs <build dir> <out.zip>     zip it; `key` is left out of the zip
//   node store-zip.mjs --check <zip>...          check zips that already exist
//
// `key` in manifest.json pins an extension's id. A development or unpacked
// build can need that (a sign-in server or a native host that allows one
// fixed id), but a store package must not have it: the Chrome Web Store
// rejects a key that does not match the listing's own id ("key field value in
// the manifest doesn't match the current item"), and Edge Add-ons rejects any
// package that has one at all. Neither failure shows up until the upload.
//
// So the build directory keeps whatever its manifest says, and only the zip
// loses the field. Every zip this writes is then read back and checked, so a
// store zip with `key` in it cannot leave here.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

function fail(message) {
  console.error(`store-zip: ${message}`);
  process.exit(1);
}

// Reads one entry out of a zip without unzip(1), which slim CI images lack:
// find the end-of-central-directory record, walk the central directory to
// the entry, then inflate it from its local header.
function readEntry(zip, name) {
  const buf = readFileSync(zip);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
      fail(`${zip}: ${name} uses compression method ${method}, which this cannot read`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// The manifest a browser reads is the one at the archive root.
function check(zip) {
  const text = readEntry(zip, "manifest.json");
  if (text === null) fail(`${zip}: no manifest.json at the archive root`);
  let manifest;
  try {
    manifest = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    fail(`${zip}: manifest.json is not valid JSON`);
  }
  if ("key" in manifest) {
    fail(`${zip}: manifest.json has a "key" field. Store packages must not carry one (Chrome rejects a key that does not match the listing, Edge rejects any key). Package with store-zip.mjs, which leaves it out.`);
  }
  console.log(`store-zip: ${zip}: no key in manifest.json (version ${manifest.version})`);
}

const args = process.argv.slice(2);
if (args[0] === "--check") {
  if (args.length < 2) fail("usage: store-zip.mjs --check <zip>...");
  for (const zip of args.slice(1)) check(zip);
  process.exit(0);
}
if (args.length !== 2) fail("usage: store-zip.mjs <build dir> <out.zip>  |  store-zip.mjs --check <zip>...");

const dir = resolve(args[0]);
const out = resolve(args[1]);
const manifestPath = join(dir, "manifest.json");
if (!existsSync(manifestPath)) fail(`${dir} has no manifest.json; build it first`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

rmSync(out, { force: true });
// Zip from inside the directory, so manifest.json lands at the archive root.
// Without a key the build directory is zipped exactly as it is.
const exclude = ["-x", "*.DS_Store"];
if (!("key" in manifest)) {
  execFileSync("zip", ["-qrX", out, ".", ...exclude], { cwd: dir });
} else {
  delete manifest.key;
  execFileSync("zip", ["-qrX", out, ".", ...exclude, "manifest.json"], { cwd: dir });
  const tmp = mkdtempSync(join(tmpdir(), "store-zip-"));
  try {
    writeFileSync(join(tmp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync("zip", ["-qX", out, "manifest.json"], { cwd: tmp });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`store-zip: left "key" out of ${out} (the build directory keeps it for unpacked use)`);
}
check(out);
