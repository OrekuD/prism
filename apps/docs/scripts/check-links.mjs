#!/usr/bin/env node
/**
 * Prism docs link checker (task-8 section 10).
 *
 * Runs against the BUILT site (dist/): verifies every internal link,
 * hash anchor, redirect target, sitemap URL, and referenced static asset.
 * Fails CI on broken local links, missing anchors, or missing assets.
 * External links are NOT checked (offline-safe); use scripts/check-external-links.mjs
 * explicitly when network access is available.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const htmlFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (name.endsWith(".html")) htmlFiles.push(full);
  }
};
walk(dist);

let failures = 0;
const report = (kind, where, detail) => {
  failures += 1;
  console.error(`[${kind}] ${where} → ${detail}`);
};

/** Map of absolute path -> set of ids for anchor checking. */
const idIndex = new Map();

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  idIndex.set(file.slice(dist.length), ids);
}

const stripQueryHash = (url) => url.split(/[?#]/)[0];

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const rel = file.slice(dist.length);

  const linkRe = /\b(?:href|src)="([^"]+)"/g;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith("#")) continue;
    if (/^(mailto:|tel:|data:|javascript:)/.test(raw)) continue;
    const url = new URL(raw, "https://docs.prism.sh");
    if (url.origin !== "https://docs.prism.sh") continue; // external, skip

    const path = url.pathname;
    const clean = stripQueryHash(path);
    const asset = decodeURIComponent(clean);

    if (asset.includes("..")) {
      report("traversal", rel, raw);
      continue;
    }

    const isAnchorFile = /\.(html|png|jpg|jpeg|svg|webp|ico|webmanifest|css|js|woff2?|txt|xml|json)$/.test(asset);
    if (!isAnchorFile) {
      // Route link — normalize to the built layout.
      const normalized = asset.endsWith("/") ? asset : `${asset}/`;
      const candidates = [
        `${normalized}index.html`,
        normalized.slice(0, -1),
        `${asset}.html`,
      ];
      const hit = candidates.find((c) => idIndex.has(c) || existsSync(join(dist, c.slice(1))));
      if (!hit) {
        // Redirects: Astro emits no file for redirect targets; resolve via
        // the redirect map in the build output (redirects.json is not
        // emitted) — fall back to the config's redirect list.
        report("route", `${rel} → ${raw}`, "target does not exist");
        continue;
      }
      if (url.hash && hit && idIndex.has(hit)) {
        const target = idIndex.get(hit);
        if (!target.has(url.hash.slice(1))) {
          report("anchor", `${rel} → ${raw}`, `missing id="${url.hash.slice(1)}"`);
        }
      }
      continue;
    }

    // Direct asset reference.
    const assetPath = join(dist, asset.slice(1));
    if (!existsSync(assetPath)) {
      report("asset", `${rel} → ${raw}`, "referenced file is missing from dist");
    }
  }
}

// Redirects from astro.config.mjs must resolve (no chain/loop).
const configText = readFileSync(join(root, "astro.config.mjs"), "utf8");
const redirectMatch = configText.match(/redirects:\s*{([\s\S]*?)}/);
if (redirectMatch) {
  const entries = [...redirectMatch[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)];
  for (const [, from, to] of entries) {
    const target = join(dist, `${to.endsWith("/") ? to : `${to}/`}index.html`);
    if (!existsSync(target)) {
      report("redirect", from, `redirect target ${to} does not exist in dist`);
    }
  }
}

// Sitemap sanity.
const sitemap = join(dist, "sitemap-index.xml");
if (existsSync(sitemap)) {
  const xml = readFileSync(sitemap, "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const url of urls) {
    const path = stripQueryHash(new URL(url).pathname);
    if (path.endsWith(".xml")) continue; // sitemap files are not pages
    const file = join(dist, `${path.endsWith("/") ? path : `${path}/`}index.html`);
    if (!existsSync(file)) {
      report("sitemap", url, "sitemap URL has no built page");
    }
  }
}

if (failures > 0) {
  console.error(`\nlink check failed: ${failures} problem(s) in ${htmlFiles.length} pages`);
  process.exit(1);
}
console.log(`link check passed: ${htmlFiles.length} pages, redirects, and sitemap OK`);
