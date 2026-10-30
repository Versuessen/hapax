#!/usr/bin/env node
// Stamp one version into every manifest that carries it.
// Usage: node scripts/set-version.mjs 1.0.42
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  console.error("usage: set-version.mjs <major.minor.patch>");
  process.exit(1);
}
const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};
json("package.json", (d) => { d.version = version; });
json("src-tauri/tauri.conf.json", (d) => { d.version = version; });
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
writeFileSync("src-tauri/Cargo.toml", cargo.replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`version set to ${version}`);
