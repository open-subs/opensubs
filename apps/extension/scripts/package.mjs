// Zip each built extension for upload.
//
// One archive per store, named for the version in package.json so two
// builds cannot be confused on a submission page. Neither is ever
// submitted from here -- upload is the last automated step, and the
// publish button belongs to a person.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = join(root, "packages");
mkdirSync(out, { recursive: true });

for (const [dir, name] of [["dist", "chrome"], ["dist-firefox", "firefox"]]) {
  const from = join(root, dir);
  if (!existsSync(from)) {
    console.error(`package: ${dir} is missing -- run npm run build:all first`);
    process.exit(1);
  }
  const zip = join(out, `opensubs-${name}-${version}.zip`);
  // store-zip.mjs zips from inside the directory, so the manifest is at the
  // archive root (a zip of the folder is rejected by every store with a
  // message about a missing manifest, which is true and unhelpful). It also
  // leaves any manifest `key` out of the zip and reads the zip back: the
  // Chrome Web Store refuses a key that does not match the listing, and Edge
  // Add-ons refuses any key, both only after the upload.
  execFileSync("node", [join(here, "store-zip.mjs"), from, zip], { stdio: "inherit" });
  console.log(`packages/opensubs-${name}-${version}.zip`);
}
