#!/usr/bin/env node
/**
 * Deterministic Prism brand export pipeline (task-7 section 3).
 *
 * Renders the canonical square mark to PNG icons at every required size,
 * builds favicon.ico (16+32), copies favicon.svg, and composes the
 * 1200x630 Open Graph image from the lockup with the Geist font embedded
 * (base64 @font-face), so exports are identical on any machine.
 *
 *   yarn workspace @prism/brand export   # regenerate + copy to consumers
 *   yarn workspace @prism/brand check    # fail if committed copies drifted
 *
 * Source assets: packages/brand/assets/*.svg (hand-built, canonical).
 * Generated outputs: packages/brand/generated/ + the consumer copies.
 */
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
const GENERATED = join(ROOT, "generated");
const ICONS = join(GENERATED, "icons");

const MARK_SIZES = [16, 32, 48, 180, 192, 512, 1024];

// Consumer copies that must never drift from the canonical sources.
const CONSUMERS = [
  ["favicon.svg", "apps/web/public/favicon.svg"],
  ["favicon.ico", "apps/web/public/favicon.ico"],
  ["apple-touch-icon.png", "apps/web/public/apple-touch-icon.png"],
  ["icon-192.png", "apps/web/public/icon-192.png"],
  ["icon-512.png", "apps/web/public/icon-512.png"],
  ["og-image.png", "apps/web/public/og-image.png"],
  ["favicon.svg", "apps/docs/public/favicon.svg"],
  ["favicon.ico", "apps/docs/public/favicon.ico"],
  ["og-image.png", "apps/docs/public/og-image.png"],
  // Generated email logo modules (same base64 PNG in both consumers).
  ["email-logo.ts", "apps/api/src/auth/email-logo.ts"],
  ["email-logo.ts", "packages/email-templates/emails/logo-png.ts"],
];

const EMAIL_LOGO_MODULE = (pngBase64) => `/**
 * GENERATED FILE — do not edit. Produced by packages/brand/scripts/export.mjs
 * from the canonical square mark (light variant, 48px). The same PNG is
 * embedded in the react-email templates, so email logos cannot drift.
 */
export const PRISM_EMAIL_LOGO_PNG =
  "data:image/png;base64,${pngBase64}";
`;

const FONT_PATH = join(
  ROOT,
  "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
);

async function fontDataUri() {
  const buffer = await readFile(FONT_PATH);
  return `data:font/woff2;base64,${buffer.toString("base64")}`;
}

function markSvg(svgText, { upper = "#F2F2F4", text } = {}) {
  let out = svgText;
  if (text !== undefined) {
    out = out
      .replace(/FONT_DATA_URI/, () => fontDataUri())
      .replace("UPPER_FILL", upper)
      .replace("TEXT_FILL", text);
  }
  return out;
}

async function renderMarkIcons() {
  await mkdir(ICONS, { recursive: true });
  const svg = await readFile(join(ASSETS, "prism-mark.svg"), "utf8");
  for (const size of MARK_SIZES) {
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(join(ICONS, `prism-mark-${size}.png`));
  }
  const ico = await pngToIco([
    join(ICONS, "prism-mark-16.png"),
    join(ICONS, "prism-mark-32.png"),
  ]);
  await writeFile(join(GENERATED, "favicon.ico"), ico);
  await copyFile(join(ASSETS, "prism-mark.svg"), join(GENERATED, "favicon.svg"));
  await copyFile(join(ICONS, "prism-mark-180.png"), join(GENERATED, "apple-touch-icon.png"));
  await copyFile(join(ICONS, "prism-mark-192.png"), join(GENERATED, "icon-192.png"));
  await copyFile(join(ICONS, "prism-mark-512.png"), join(GENERATED, "icon-512.png"));
}

async function renderEmailLogo() {
  const png = await sharp(join(ICONS, "prism-mark-48.png")).png().toBuffer();
  await writeFile(
    join(GENERATED, "email-logo.ts"),
    EMAIL_LOGO_MODULE(png.toString("base64")),
  );
}

async function renderOgImage() {
  const font = await fontDataUri();
  const lockup = await readFile(join(ASSETS, "prism-lockup.svg"), "utf8");
  const lockupDark = lockup
    .replace(/FONT_DATA_URI/, font)
    .replace("UPPER_FILL", "#F2F2F4")
    .replace("TEXT_FILL", "#F2F2F4");
  const inner = lockupDark.slice(
    lockupDark.indexOf(">") + 1,
    lockupDark.lastIndexOf("</svg>"),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#050506"/>
  <g transform="translate(240 207) scale(3)">${inner}</g>
</svg>`;
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toFile(join(GENERATED, "og-image.png"));
}

async function copyToConsumers() {
  for (const [file, dest] of CONSUMERS) {
    await copyFile(join(GENERATED, file), join(ROOT, "../../", dest));
  }
}

async function checkDrift() {
  const repo = join(ROOT, "../..");
  let drifted = false;
  for (const [file, dest] of CONSUMERS) {
    const generated = await readFile(join(GENERATED, file));
    const committed = await readFile(join(repo, dest));
    const g = createHash("sha256").update(generated).digest("hex");
    const c = createHash("sha256").update(committed).digest("hex");
    if (g !== c) {
      drifted = true;
      console.error(`  ✗ drift: ${dest} differs from the canonical export`);
    } else {
      console.log(`  ✓ ${dest}`);
    }
  }
  if (drifted) {
    console.error("\nRegenerate with: yarn workspace @prism/brand export");
    process.exit(1);
  }
}

const checkOnly = process.argv.includes("--check");

await mkdir(GENERATED, { recursive: true });
await renderMarkIcons();
await renderEmailLogo();
await renderOgImage();

if (checkOnly) {
  await checkDrift();
} else {
  await copyToConsumers();
  console.log(
    "[prism-brand] exported icons, favicon, and og-image to consumers.",
  );
}
