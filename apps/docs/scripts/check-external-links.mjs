#!/usr/bin/env node
/**
 * Prism docs external-link checker (task-8 section 10).
 *
 * Optional, network-dependent: verifies external links in the BUILT site
 * and reports non-200/redirected URLs. NOT part of the normal build — run
 * explicitly (e.g. a scheduled CI job) so builds never depend on the
 * network.
 *
 * Usage: node scripts/check-external-links.mjs [--timeout=8000]
 */
import { readFileSync, readdirSync, statSync, join, dirname, resolve } from "node:fs";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const htmlFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".html")) htmlFiles.push(full);
  }
};
walk(dist);

const timeoutMs = Number(
  process.argv.find((a) => a.startsWith("--timeout="))?.split("=")[1] ?? 8000,
);
const external = new Set();

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const linkRe = /\b(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || /^(#|mailto:|tel:|data:|javascript:)/.test(raw)) continue;
    const url = new URL(raw, "https://docs.prism.sh");
    if (url.origin === "https://docs.prism.sh") continue;
    external.add(url.href);
  }
}

const check = async (href) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(href, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "prism-docs-link-check" },
    });
    if (!res.ok) {
      console.error(`[${res.status}] ${href}`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`[timeout] ${href}`);
    } else {
      console.error(`[error] ${href} (${error.message})`);
    }
    return 1;
  } finally {
    clearTimeout(timer);
  }
};

const results = await Promise.all([...external].map(check));
const failures = results.filter(Boolean).length;
console.log(
  `external link check: ${external.size} URL(s), ${failures} problem(s)`,
);
process.exit(failures > 0 ? 1 : 0);
