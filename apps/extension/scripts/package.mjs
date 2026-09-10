// Zip each built extension for upload.
//
// One archive per store, named for the version in package.json so two
// builds cannot be confused on a submission page. Neither is ever
// submitted from here -- upload is the last automated step, and the
// publish button belongs to a person.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
  rmSync(zip, { force: true });
  // -r from inside the directory, so the manifest is at the archive root.
  // A zip of the folder is rejected by every store with a message about a
  // missing manifest, which is true and unhelpful.
  execFileSync("zip", ["-qr", zip, "."], { cwd: from });
  console.log(`packages/opensubs-${name}-${version}.zip`);
}
