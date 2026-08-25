#!/usr/bin/env node
/**
 * Bump @prism-analytics/* packages independently.
 * Versions are no longer locked — bump only the package that changed.
 * Usage:
 *   node scripts/bump.mjs browser 0.0.2
 *   node scripts/bump.mjs core 0.0.3
 *   node scripts/bump.mjs react 0.1.0        # alias for reactjs (npm: @prism-analytics/react)
 *   node scripts/bump.mjs react-native 0.0.2
 *   node scripts/bump.mjs --all 0.0.3        # bump all 5 at once (rare)
 */
import { readFileSync, writeFileSync } from "node:fs";

const ALIASES = {
  browser: "packages/browser/package.json",
  core: "packages/core/package.json",
  node: "packages/node/package.json",
  react: "packages/reactjs/package.json",
  "prism-react": "packages/reactjs/package.json",
  "react-native": "packages/react-native/package.json",
};

function usage() {
  console.error("Usage:");
  console.error("  node scripts/bump.mjs <pkg> <version>   # bump one");
  console.error("  node scripts/bump.mjs --all <version>  # bump all 5");
  console.error("  pkg: browser | core | node | react | react-native");
  console.error("  e.g. node scripts/bump.mjs browser 0.0.2");
  process.exit(1);
}

let pkgArg, version;
if (process.argv[2] === "--all") {
  pkgArg = "--all";
  version = process.argv[3];
} else {
  pkgArg = process.argv[2];
  version = process.argv[3];
}

if (!pkgArg || !version || !/^\d+\.\d+\.\d+/.test(version)) usage();

const targets = pkgArg === "--all" ? Object.values(ALIASES) : [ALIASES[pkgArg]];

if (!targets[0]) {
  console.error(`Unknown package "${pkgArg}"`);
  usage();
}

// dedupe (react + prism-react alias)
const uniq = [...new Set(targets)];

for (const p of uniq) {
  const j = JSON.parse(readFileSync(p, "utf8"));
  j.version = version;
  writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  console.log(`  bumped ${j.name} -> ${version} (${p})`);
}

console.log(`\nDone. Next: yarn install, git commit, then bash scripts/release.sh`);
