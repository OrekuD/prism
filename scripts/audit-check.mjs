#!/usr/bin/env node
/**
 * CI dependency-audit gate.
 *
 * Reads `yarn audit --groups dependencies --json` from stdin and exits
 * non-zero only when a high/critical advisory is reachable from a production
 * workspace and is not explicitly allowlisted below.
 *
 * Findings in build-time-only tooling (prism-docs, @prism/email-templates)
 * are reported but do not fail the build; they are tracked in
 * docs/dependency-security.md.
 */
import { readFileSync } from "node:fs";

const PRODUCTION_ROOTS = new Set([
  "prism-web",
  "prism-api",
  "prism-analytics-api",
  "@prism/core",
  "@prism/react",
  "@prism/types",
]);

/**
 * Documented accepted findings: advisory id -> { owner, followUp }.
 * Add an entry here only after recording the rationale in
 * docs/dependency-security.md. Currently empty: no blocking production
 * findings and no accepted high/critical advisories.
 */
const ALLOWLIST = new Map();

const lines = readFileSync(0, "utf8")
  .split("\n")
  .filter((line) => line.trim());

const advisories = new Map();
for (const line of lines) {
  try {
    const data = JSON.parse(line);
    if (data?.data?.advisory) {
      const advisory = data.data.advisory;
      const key = `${advisory.module_name}@${advisory.vulnerable_versions}`;
      if (!advisories.has(key)) {
        advisories.set(key, { ...advisory, findings: [] });
      }
      for (const finding of advisory.findings ?? []) {
        advisories.get(key).findings.push(...finding.paths);
      }
    }
  } catch {
    // Non-JSON lines (summary output) are ignored.
  }
}

const high = [...advisories.values()].filter(
  (a) => a.severity === "high" || a.severity === "critical",
);

const blocking = [];
for (const advisory of high) {
  const reachesProduction = advisory.findings.some((path) => {
    const root = path.split(">")[0].trim();
    return PRODUCTION_ROOTS.has(root);
  });

  if (!reachesProduction) {
    console.log(
      `[audit] non-blocking (build-time): ${advisory.severity} ${advisory.module_name}`,
    );
    continue;
  }

  if (ALLOWLIST.has(advisory.id)) {
    const entry = ALLOWLIST.get(advisory.id);
    console.log(
      `[audit] allowlisted ${advisory.module_name} (owner: ${entry.owner}, follow-up: ${entry.followUp})`,
    );
    continue;
  }

  blocking.push(
    `${advisory.severity} ${advisory.module_name} (${advisory.title})`,
  );
}

if (blocking.length > 0) {
  console.error("[audit] BLOCKING production-runtime findings:");
  for (const finding of blocking) {
    console.error(`  - ${finding}`);
  }
  console.error(
    "[audit] Fix the finding or document it in docs/dependency-security.md and allowlist it with an owner + follow-up task.",
  );
  process.exit(1);
}

console.log("[audit] OK — no blocking production-runtime advisories.");
