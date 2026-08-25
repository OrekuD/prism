#!/usr/bin/env node
/**
 * Deterministic Prism brand export pipeline (task-7 section 3; updated for
 * the canonical prism-logo.png — the new logo asset).
 *
 * Renders the canonical square PNG logo (packages/brand/assets/prism-logo.png)
 * to icons at every required size, builds favicon.ico (16+32), and composes
 * the 1200x630 Open Graph image (logo + PRISM wordmark with the Geist font
 * embedded as base64 @font-face). Pixels are deterministic on any machine;
 * `check` compares decoded pixels so platform PNG-encoder differences do
 * not produce false drift.
 *
 *   yarn workspace @prism-analytics/brand export   # regenerate + copy to consumers
 *   yarn workspace @prism-analytics/brand check    # fail if committed copies drifted
 *
 * Source asset: packages/brand/assets/prism-logo.png (canonical).
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

const MARK_SIZES = [16, 32, 48, 72, 180, 192, 512, 1024];

// Consumer copies that must never drift from the canonical sources.
const CONSUMERS = [
  ["favicon.ico", "apps/web/public/favicon.ico"],
  ["apple-touch-icon.png", "apps/web/public/apple-touch-icon.png"],
  ["icon-192.png", "apps/web/public/icon-192.png"],
  ["icon-512.png", "apps/web/public/icon-512.png"],
  ["og-image.png", "apps/web/public/og-image.png"],
  ["favicon.ico", "apps/docs/public/favicon.ico"],
  ["og-image.png", "apps/docs/public/og-image.png"],
  // Generated email logo modules (same base64 PNG in both consumers).
  ["email-logo.ts", "apps/api/src/auth/email-logo.ts"],
  ["email-logo.ts", "packages/email-templates/emails/logo-png.ts"],
];

const EMAIL_LOGO_MODULE = (pngBase64) => `/**
 * GENERATED FILE — do not edit. Produced by packages/brand/scripts/export.mjs
 * from the canonical prism-logo.png (48px). The same PNG is embedded in
 * the react-email templates, so email logos cannot drift.
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

/**
 * Platform-stable signature (R3-CI): sharp's SVG text rasterization embeds
 * platform-dependent antialiasing, so committed og-image BYTES differ
 * between macOS and Linux even when pixels are identical. Compare decoded
 * pixels (+ dimensions) instead; encoder-only differences no longer fail
 * the gate. ICO containers keep a byte compare (libvips cannot decode).
 */
async function pixelSignature(file) {
  const img = sharp(file).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return createHash("sha256")
    .update(`${info.width}x${info.height}:`)
    .update(data)
    .digest("hex");
}

async function renderMarkIcons() {
  await mkdir(ICONS, { recursive: true });
  const logo = await readFile(join(ASSETS, "prism-logo.png"));
  for (const size of MARK_SIZES) {
    await sharp(logo)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(join(ICONS, `prism-logo-${size}.png`));
  }
  const ico = await pngToIco([
    join(ICONS, "prism-logo-16.png"),
    join(ICONS, "prism-logo-32.png"),
  ]);
  await writeFile(join(GENERATED, "favicon.ico"), ico);
  await copyFile(join(ICONS, "prism-logo-180.png"), join(GENERATED, "apple-touch-icon.png"));
  await copyFile(join(ICONS, "prism-logo-192.png"), join(GENERATED, "icon-192.png"));
  await copyFile(join(ICONS, "prism-logo-512.png"), join(GENERATED, "icon-512.png"));
}

async function renderEmailLogo() {
  const png = await sharp(join(ICONS, "prism-logo-48.png")).png().toBuffer();
  await writeFile(
    join(GENERATED, "email-logo.ts"),
    EMAIL_LOGO_MODULE(png.toString("base64")),
  );
}

async function renderOgImage() {
  const font = await fontDataUri();
  // The old lockup's mark geometry is replaced by the canonical PNG; the
  // PRISM wordmark keeps the lockup position (baseline y=48, x=64, size
  // 36, letter-spacing 9 — scaled 3x onto the 1200x630 canvas).
  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <style>
      @font-face {
        font-family: "Geist";
        src: url("${font}") format("woff2");
        font-weight: 100 900;
      }
    </style>
  </defs>
  <rect width="1200" height="630" fill="#050506"/>
  <text x="432" y="351" font-family="Geist, sans-serif" font-size="108" font-weight="600" letter-spacing="27" fill="#F2F2F4">PRISM</text>
</svg>`;
  const logo = await sharp(join(ICONS, "prism-logo-72.png")).png().toBuffer();
  await sharp(Buffer.from(textSvg))
    .composite([{ input: logo, left: 288, top: 231 }])
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
    const generatedPath = join(GENERATED, file);
    const committedPath = join(repo, dest);
    const isPng = file.endsWith(".png");
    const g = isPng
      ? await pixelSignature(generatedPath)
      : createHash("sha256").update(await readFile(generatedPath)).digest("hex");
    const cHash = isPng
      ? await pixelSignature(committedPath)
      : createHash("sha256").update(await readFile(committedPath)).digest("hex");
    if (g !== cHash) {
      drifted = true;
      console.error(`  ✗ drift: ${dest} differs from the canonical export`);
    } else {
      console.log(`  ✓ ${dest}`);
    }
  }
  if (drifted) {
    console.error("\nRegenerate with: yarn workspace @prism-analytics/brand export");
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
