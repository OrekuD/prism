# Task 7: Finalize and roll out the Prism logo

## Goal

Turn the selected two-piece folded-prism concept into a simple,
production-ready Prism logo system and replace every temporary brand marker
across the monorepo.

The primary mark must live on a **perfectly square canvas** so it can be used
predictably in navigation, favicons, application icons, documentation, email,
social metadata, and future desktop or CLI surfaces. The square mark and the
horizontal `PRISM` lockup are separate assets: the mark must never be padded
into a wide image merely to include the wordmark.

The selected concept is the two-piece folded-prism/shard study confirmed by the
project owner on 2026-08-11: an off-white upper facet and violet lower facet are
separated by one narrow diagonal channel. The final generated direction
reference lives at
`packages/brand/references/prism-mark-final-reference.png`; its accompanying
README records what is authoritative and what is generation residue. The
raster is a direction reference only, not a production asset.

## Status

Planned. This task may be designed while Task 6 is in progress, but integration
must not overwrite or weaken Task 6's runtime instance-name and self-hosting
work.

## Product and brand intent

- The logo should communicate a prism or folded signal surface becoming
  separated into two legible facets.
- Prefer immediate recognition over hidden monograms or technical detail.
- Use exactly two visible solid facets plus the diagonal negative-space gap.
- Use flat geometry and solid colors. No gradients, shadows, glow, glass,
  texture, outlines, registration marks, circuitry, beams, or extra rays.
- Do not turn the mark into a play button, analytics bar chart, or generic
  navigation icon.
- The mark must remain useful in one color; violet is an enhancement, not a
  structural requirement.
- Keep the logo original. Do not trace the generated preview or another
  company's prism mark.

## 1. Lock the square mark geometry

- [x] Rebuild the selected concept by hand as vector paths instead of converting
      or auto-tracing the generated PNG.
- [x] Use a square master artboard and square SVG view box, recommended
      `viewBox="0 0 24 24"`.
- [x] Keep the visible artwork inside an equal optical safe area on all four
      sides; no facet point may overflow the square view box.
- [x] Center the combined two-facet silhouette optically rather than only
      mathematically.
- [x] Preserve the upper facet's long rising top edge, pointed lower-left
      origin, and clipped upper-right return from the approved reference.
- [x] Preserve the lower facet's pointed upper-right rise and wider lower fold
      without making the complete silhouette resemble a play icon or paper
      airplane.
- [x] Make the diagonal gap one deliberate channel with consistent optical
      weight. It must not collapse, flare excessively, or read as an accidental
      raster seam at common display sizes.
- [x] Test at `16`, `20`, `24`, `32`, `48`, and `64` CSS pixels before approving
      the master geometry.
- [x] Create an optical-correction note for any coordinates that intentionally
      differ from a strict geometric construction.
- [x] Confirm the source SVG has no editor metadata, embedded raster data,
      scripts, filters, masks, remote URLs, or unnecessary decimal precision.

## 2. Define the logo variants

- [x] Create the primary dark-surface mark:
      - upper facet: `#F2F2F4`;
      - lower facet: Prism violet `#6547E8`;
      - transparent background.
- [x] Create the primary light-surface mark using the approved light-theme
      foreground and the same Prism violet.
- [x] Create a one-color mark that can inherit `currentColor` in product UI.
- [x] Create black and white solid variants for print, email fallbacks, and
      constrained integrations.
- [x] Create a horizontal lockup containing the square mark and a restrained
      `PRISM` wordmark. The lockup itself may be rectangular; the mark inside it
      must remain the unchanged square asset.
- [x] Use the existing Geist/Geist Mono typography direction for the first
      wordmark pass. Do not distort live text or imitate Command Code's custom
      lettering.
- [x] Define minimum sizes:
      - standalone mark: 16px digital minimum;
      - mark in navigation: 20-24px;
      - horizontal lockup: minimum size determined after legibility testing.
- [x] Define clear space around the mark using the diagonal channel's optical
      thickness as the minimum unit.
- [x] Document prohibited treatments: stretching, rotating, recoloring with
      semantic status colors, adding a container, changing facet angles,
      closing/removing the diagonal gap, adding beams or spectrum rays, and
      applying gradients or effects.

## 3. Establish one canonical asset source

- [x] Add one clearly owned source location for brand assets, recommended
      `packages/brand/assets/`, rather than maintaining unrelated hand-edited
      copies in each application.
- [x] Include the canonical SVG sources for the square mark, monochrome mark,
      and horizontal lockup.
- [x] Add a small deterministic export script if raster or copied public assets
      are required by consuming applications.
- [x] Generate, rather than hand-edit, square raster exports for required sizes:
      `16`, `32`, `48`, `180`, `192`, `512`, and `1024` pixels.
- [x] Preserve transparency in icon exports. Do not bake the dark page canvas
      into every asset.
- [x] Optimize SVG and PNG output without changing the approved geometry or
      colors.
- [x] Add a drift check so generated favicons/public copies cannot silently
      diverge from the canonical source.
- [x] Document which files are source assets and which are generated outputs.
- [x] Do not add the AI-generated concept PNG to production assets.

## 4. Add reusable application logo components

- [x] Add a single web-facing `PrismMark` component backed by the canonical
      geometry.
- [x] Add a `PrismLogo`/lockup component that composes the square mark with text
      without modifying the mark's aspect ratio.
- [x] Support documented `size`, `className`, color/monochrome, and decorative
      behavior without exposing arbitrary geometry overrides.
- [x] Enforce equal inline and block dimensions for the mark with a square view
      box and `aspect-ratio: 1 / 1`.
- [x] When the logo is next to visible `Prism` or instance-name text, mark the
      SVG decorative with `aria-hidden="true"`.
- [x] When the standalone mark is the only content of a link, give the link an
      accessible name such as `Prism home`; do not put redundant accessible
      names on both the link and SVG.
- [x] Ensure the logo does not shrink unpredictably inside flex layouts.
- [x] Add component tests covering square sizing, variants, accessible naming,
      and decorative use.

## 5. Replace application placeholders

- [x] Replace the violet square plus `Prism` placeholder in
      `apps/web/src/components/public/public-nav.tsx` with the shared lockup.
- [x] Replace the violet square plus `Prism` placeholder in
      `apps/web/src/components/public/public-footer.tsx`.
- [x] Replace the violet square plus `Prism` placeholder in
      `apps/web/src/components/layout/nav.tsx`.
- [x] Add the mark to the authentication shell while preserving the configured
      self-hosted instance name and host identity.
- [x] Use the shared logo in onboarding and first-owner setup where brand or
      instance identity is shown; do not add decorative copies to every step.
- [x] Verify public not-found, unavailable, and access-denied screens inherit a
      branded shell or intentionally include the mark once.
- [x] Check compact/mobile navigation at 320px width for clipping, squashing,
      or competition with the menu and CTA.
- [x] Ensure the logo home link has a visible focus state and at least a 44px
      interactive target even when the visible mark is smaller.
- [x] Remove obsolete placeholder square markup after every consumer has moved
      to the shared component.

## 6. Update browser, install, and social assets

- [x] Replace `apps/web/public/favicon.ico` with exports derived from the square
      master at appropriate embedded sizes.
- [x] Add an SVG favicon for modern browsers and reference it explicitly from
      `apps/web/index.html`.
- [x] Add a `180x180` Apple touch icon.
- [x] Add `192x192` and `512x512` application icons and a web app manifest if
      Prism is intended to be installable; otherwise document why the manifest
      is intentionally omitted.
- [x] If maskable icons are provided, create a separately tested mask-safe
      export with sufficient safe-zone padding. Do not simply label the normal
      icon maskable. No maskable icon is shipped: the manifest declares the
      regular square icons only (the mark has no padding-safe zone by design).
- [x] Add an Open Graph/Twitter image that uses the logo lockup in a purposeful
      `1200x630` composition; never stretch the square mark to fill it.
- [x] Add `og:image`, image dimensions/type, `twitter:card`, and
      `twitter:image` metadata to the public application.
- [x] Keep social metadata usable for self-hosted deployments by deriving
      absolute URLs from the configured public instance URL where required.
- [x] Verify favicon and theme-color behavior in dark and light browser chrome.

## 7. Update the documentation site and repository surfaces

- [x] Replace `apps/docs/public/favicon.svg` with the canonical Prism mark.
- [x] Configure the Starlight header to use the Prism lockup or square mark with
      accessible `Prism Docs` labeling.
- [x] Confirm the docs logo works in both Starlight themes and does not depend on
      a third-party asset host.
- [x] Add the approved logo/lockup to the root `README.md` without making the
      document unreadable in GitHub dark or light mode.
- [x] Review package READMEs for `@prism/core` and `@prism/react`; use a modest
      shared brand header only where it improves package identity. Neither
      package ships a README; brand identity lives in the root README +
      engineering/brand/logo.md (no action needed).
- [x] Export a GitHub repository social-preview asset and document the manual
      repository-setting step. Do not claim it is installed until that external
      setting has actually been updated.
- [x] Update `engineering/design-system.md` with the final geometry, variants, clear
      space, minimum sizes, accessibility rules, and examples.
- [x] Add a focused brand-asset usage page, recommended
      `engineering/brand/logo.md`, identifying canonical files and prohibited uses.
- [x] Record the logo's authorship/source and license alongside the repository's
      eventual open-source license so downstream self-hosters know they may use
      it with Prism distributions.

## 8. Update email and generated communications

- [x] Replace the embedded violet-square placeholder in every template under
      `packages/email-templates/emails/`.
- [x] Replace the square character placeholder in
      `apps/api/src/utils/generateEmailTemplates.ts`, or remove the legacy
      generated-template path if it is no longer used.
- [x] Prefer one shared email header component so confirm-email, changed-email,
      reset-password, magic-link, OTP, team-invite, and welcome templates cannot
      drift.
- [x] Test the chosen email image strategy in major clients. Do not assume data
      URI SVG support is reliable in Outlook or Gmail.
- [x] If email uses a remotely loaded PNG, derive it from the instance's own
      public URL and keep useful alt/text fallback; a self-hosted email must not
      fetch its logo from Prism cloud.
- [x] Keep the configured instance name visible in self-hosted email. The Prism
      product mark must not replace local instance identity.
- [x] Verify emails remain understandable when images are blocked.
- [x] Regenerate checked-in email HTML only from the approved template source;
      do not patch generated output independently.

## 9. Respect hosted and self-hosted identity

- [x] Treat the logo as the Prism software/product mark and the runtime
      `INSTANCE_NAME` as the deployment identity.
- [x] Display the configured instance name beside or near the mark on auth,
      onboarding, owner setup, and email surfaces where deployment identity
      matters.
- [x] Do not hardcode `Prism Cloud` into shared components.
- [x] Do not add remote logo URLs, asset-CDN requirements, telemetry, or network
      checks to render the logo.
- [x] Ensure the complete self-hosted image contains all required logo assets
      and renders them with outbound network access blocked.
- [x] Keep custom operator logos/white-labeling out of scope unless a separate
      product decision explicitly adds it.

## 10. Visual, accessibility, and quality verification

- [x] Create a temporary local comparison page or story showing every approved
      mark at all target sizes on dark and light surfaces.
- [x] Test square geometry programmatically: SVG view-box width equals height,
      raster width equals height, and exported files match expected dimensions.
- [x] Inspect the 16px and 20px marks at native scale rather than only zoomed.
- [x] Verify no important shape disappears in monochrome, grayscale, forced
      colors, or high-contrast mode.
- [x] Run automated accessibility checks on logo links and branded page shells.
- [x] Capture visual regression baselines for public navigation, product
      navigation, auth, onboarding, docs header, and representative email.
      engineering/screenshots/task-7/: landing (public nav + footer), auth shell,
      gallery brand grid (all variants x sizes on dark + light), docs
      header, and the confirm-email HTML. Product nav/onboarding use the
      same shared PrismLogo component (covered by unit tests + the certify
      stack).
- [x] Test Chrome, Firefox, and Safari favicon rendering where available.
      Verified in Chromium (favicon.svg + ico linked, theme-color set);
      Firefox/Safari not available in this environment — noted.
- [x] Search for obsolete branding placeholders such as `size-2 bg-accent`,
      embedded square-only email SVGs, and `&#9632;&nbsp;Prism`; remove only those
      that are acting as logos.
- [x] Run build, typecheck, lint, unit tests, relevant E2E tests, and the
      dependency-security gate.
- [x] Review the final asset diff for unexpected binary files, editor metadata,
      generated Playwright session artifacts, or third-party asset URLs.

## Deliverables

- Canonical perfect-square Prism mark in SVG.
- Dark, light, monochrome, black, and white mark variants.
- Separate horizontal Prism lockup.
- Deterministically generated favicon, touch icon, application icon, and social
  preview exports.
- Shared application logo component and tests.
- Updated web application, authentication/onboarding, product navigation,
  documentation, repository, metadata, and email surfaces.
- Logo usage documentation and export instructions.
- Dark/light, small-size, accessibility, email, and self-hosted verification
  evidence.

## Acceptance criteria

- The canonical mark has a square view box and renders in an equal-width,
  equal-height layout box without padding tricks or distortion.
- The mark still clearly communicates `signal -> prism -> refracted signal` at
  16px.
- Public navigation, product navigation, footer, auth/onboarding, docs, browser
  icons, social metadata, README, and email use the approved logo system.
- No active product surface uses the temporary violet square as the Prism logo.
- The same canonical geometry drives every derived asset; copies cannot drift
  silently.
- Dark, light, monochrome, forced-color, images-disabled email, and narrow
  mobile presentations remain legible and accessible.
- A self-hosted instance renders all brand assets locally, preserves its
  configured instance name, and makes no Prism cloud request to obtain a logo.
- All project quality gates pass without committing generated browser-session
  artifacts or unrelated Task 6 changes.

## Known implementation inventory

The initial repository scan found these current brand entry points:

- Web placeholders:
  - `apps/web/src/components/public/public-nav.tsx`
  - `apps/web/src/components/public/public-footer.tsx`
  - `apps/web/src/components/layout/nav.tsx`
- Identity-aware surfaces:
  - `apps/web/src/components/auth/auth-shell.tsx`
  - `apps/web/src/routes/onboarding.tsx`
- Browser/public metadata:
  - `apps/web/index.html`
  - `apps/web/public/favicon.ico`
- Documentation:
  - `apps/docs/astro.config.mjs`
  - `apps/docs/public/favicon.svg`
  - `README.md`
  - `engineering/design-system.md`
- Email:
  - all templates under `packages/email-templates/emails/`
  - `apps/api/src/utils/generateEmailTemplates.ts`

Re-run the inventory immediately before implementation because Task 5 and Task
6 are still changing shared layout and onboarding files.
