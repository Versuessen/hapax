#!/usr/bin/env node
// Build the updater manifest (latest.json) from the signed bundles of one release.
// Usage: node scripts/make-latest-json.mjs <version> <tag> <dir-with-bundles> <notes-file>
//
// Keys follow tauri-plugin-updater >= 2.10: `{os}-{arch}-{bundle}` is tried
// first, then `{os}-{arch}`. So an RPM install updates from the .rpm, a deb
// install from the .deb, and anything else falls back to AppImage / NSIS.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, tag, dir, notesFile] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY || "Versuessen/hapax";
const files = readdirSync(dir);
const pick = (re) => files.find((f) => re.test(f) && !f.endsWith(".sig"));
const entry = (file) => {
  if (!file) return null;
  const sig = readFileSync(join(dir, `${file}.sig`), "utf8").trim();
  return { url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`, signature: sig };
};

const rpm = entry(pick(/\.rpm$/));
const deb = entry(pick(/\.deb$/));
const appimage = entry(pick(/\.AppImage$/));
const nsis = entry(pick(/-setup\.exe$/));

const platforms = {};
if (rpm) platforms["linux-x86_64-rpm"] = rpm;
if (deb) platforms["linux-x86_64-deb"] = deb;
if (appimage) { platforms["linux-x86_64-appimage"] = appimage; platforms["linux-x86_64"] = appimage; }
if (nsis) { platforms["windows-x86_64-nsis"] = nsis; platforms["windows-x86_64"] = nsis; }
if (!Object.keys(platforms).length) {
  console.error(`no signed bundles found in ${dir}`);
  process.exit(1);
}

const manifest = {
  version,
  notes: readFileSync(notesFile, "utf8").trim(),
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms,
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json: ${Object.keys(platforms).join(", ")}`);
