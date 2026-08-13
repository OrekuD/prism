#!/usr/bin/env node
/**
 * Declaration/docs drift test (task-9 §14): extracts every exported name
 * from @prism/core's built declarations and asserts the API reference
 * page mentions each one — the docs can never silently fall behind the
 * contract.
 *
 * Usage: node scripts/docs-api-drift.mjs
 */
import { readFileSync } from "node:fs";

const DTS = "packages/core/dist/index.d.ts";
const DOCS = "apps/docs/content/docs/api-reference/core.mdx";

const dts = readFileSync(DTS, "utf8");
const docs = readFileSync(DOCS, "utf8");

// tsup bundles the entry into ONE trailing export block: export { A, B };
const block = dts.match(/export\s*\{([^}]*)\}\s*;\s*$/s);
if (!block) {
  console.error("no export block found in " + DTS + " — is the core built?");
  process.exit(1);
}

const names = new Set();
for (const part of block[1].split(",")) {
  const name = part.trim().split(" as ").pop()?.replace(/^type\s+/, "").trim();
  if (name) names.add(name);
}

let failed = 0;
for (const name of [...names].sort()) {
  if (!docs.includes(name)) {
    console.error(`DRIFT: "${name}" is exported but missing from the API reference`);
    failed += 1;
  }
}
if (failed > 0) {
  console.error(`docs API drift: ${failed} missing name(s)`);
  process.exit(1);
}
console.log(`docs API drift: OK (${names.size} exported names all documented)`);
