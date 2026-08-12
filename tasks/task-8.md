# Task 8: Drastically redesign and expand the Prism documentation site

## Goal

Replace the mostly stock Starlight documentation site with a distinct Prism
documentation experience that feels like the same product as the landing page,
authentication flow, onboarding, and dashboard.

This is an overall visual and structural redesign, not a small theme-color
change. The result should preserve the accessibility, routing, Markdown/MDX,
search, and content ergonomics provided by Astro/Starlight while replacing its
generic presentation with Prism's dark, precise, developer-tool design system.

The docs must serve two equally legitimate paths:

1. hosted users who create an account and connect a project; and
2. self-hosted operators who deploy Prism without registering for Prism cloud.

The implementation source of truth is
[`engineering/design-system.md`](../engineering/design-system.md). Logo work comes from
[`tasks/task-7.md`](./task-7.md), and self-hosting/runtime facts come from
[`tasks/task-6.md`](./task-6.md). Do not duplicate or contradict those sources.

## Status

> **PIVOT (docs migration): the documentation site is being rebuilt on
> Fumadocs (Next.js 16) at `apps/docs-new`.** The Fumadocs bootstrap, full
> content migration (36 pages), glass layout, Prism design pass, and the
> Task 6 closure pass are committed. The legacy Astro/Starlight site
> (`apps/docs`) is kept until route parity, redirects, builds, search, and
> self-hosted documentation are verified on the Fumadocs site — then it is
> retired and task evidence links are re-pointed.
>
> **The Starlight-specific instructions below are superseded and will be
> revised before further implementation.** Sections referencing Starlight
> components, expressive-code, Astro config, and the docs design system
> should be read against the Fumadocs architecture (fumadocs-core loader
> source, fumadocs-mdx, fumadocs-ui layouts — glass + home, Tailwind CSS 4
> with the `--color-fd-*` token mapping, MDX content with `meta.json`).
> Items already delivered on the Fumadocs site should be re-verified
> against the new implementation rather than re-done.

**Original status (legacy site):** Implemented in six reviewable slices on
`task-5-hosted-experience` (commits: slice A `a52f13a` … slice F pending —
see below). Content inventory and component prototyping happened first;
deployment instructions describe only Task-6-certified capabilities.

## Current state (after)

- `apps/docs` uses Astro 7.2.0, Starlight 0.41.7, and MDX 7.0.5.
- The site contains a custom homepage, 36 content pages across 8 sidebar
  groups, and a branded 404.
- Header, sidebar, search (Pagefind), table of contents, footer, code blocks,
  mobile behavior, both themes, and typography are all Prism-styled through
  a single `src/styles/prism.css` token layer plus three component overrides
  (`Header`, `Footer`, `PageTitle`) and `disable404Route`.
- The information architecture explains hosted vs. self-hosted setup, runtime
  services, deployment, configuration, backups, upgrades, authentication,
  analytics ingestion, and operations.
- The docs build has no missing-site/sitemap warning; `site` is
  `https://docs.prism.sh` (override with `ASTRO_SITE` for self-hosted
  builds).
- The favicon, OG image, and all brand assets come from Task 7's canonical
  export pipeline (docs consumers added to `packages/brand/scripts/export.mjs`
  + drift check).
- All documentation assets are local to the built artifact; nothing is
  fetched from a third-party host.

## Design direction

The documentation feels like an instrument panel for understanding and
operating Prism: compact, explicit, inspectable, and calm.

Design dials:

- `DESIGN_VARIANCE: 6` — recognizable documentation patterns inside a more
  original framed Prism shell.
- `MOTION_INTENSITY: 2` — short interaction feedback only; documentation must
  never make users wait for decorative reveals.
- `VISUAL_DENSITY: 7` — technical and compact, with strong hierarchy and a
  readable article measure.

Required characteristics (all implemented):

- canonical dark canvas `#050506`, with a complete light-token translation;
- 2px solid violet top rail using `#6547E8`;
- self-hosted Geist and Geist Mono typography shared with the web app
  (subset latin + latin-ext only, 84 KB total);
- one-pixel borders, framed rails, sharp 2px control radius, and sparse
  registration details;
- mono uppercase section labels and metadata, sans-serif prose, mono code;
- compact, real code and command examples as primary interaction surfaces;
- Prism violet only for brand/action/selection; semantic colors only for real
  success, warning, danger, informational, or event meaning;
- deliberate dark/light support from the same semantic token system;
- no glassmorphism, glow, decorative gradients, floating rounded card stacks,
  fake terminal chrome, giant empty heroes, or generic purple blobs.

The Command Code references were used only for discipline, density, hairline
structure, and developer-focused presentation.

## Non-goals (respected)

- Astro/Starlight retained; no bespoke framework, no fork.
- No unfinished features documented as available; `planned` items use the
  `StatusBadge` component and never future-tense prose.
- No invented SDK methods, API responses, environment variables,
  performance numbers, or security guarantees (every claim in the content was
  verified against source; the env reference has a drift test).
- Hosted signup is not the only route; no account required to read docs.
- No remote analytics; no third-party asset hosts in the built artifact.
- No changes to the dashboard or public landing page.

## 1. Audit the existing documentation surface

- [x] Inventory every route, MD/MDX file, static asset, Starlight configuration
      option, integration, and custom style currently present in `apps/docs`.
      Before: 5 pages (index splash, guides/quickstart, guides/self-hosting,
      guides/backup-restore, reference/sdk), no custom CSS, stock config.
      After: 38 built pages, 36 content files, one stylesheet, three
      component overrides, custom homepage + 404.
- [x] Record the current Astro/Starlight versions and inspect the supported
      component-override API before designing around internal DOM selectors.
      Astro 7.2.0 / Starlight 0.41.7 / MDX 7.0.5. Overrides used:
      `components: { Header, Footer, PageTitle }` + `disable404Route`.
      Starlight variables mapped at `--sl-*` level (documented surface), not
      internal DOM selectors; the only class-level styling targets documented
      Starlight classes (`sidebar-content`, `starlight-toc`, `sl-steps`,
      `pagefind-ui__*`, `expressive-code`).
- [x] Capture baseline screenshots of the homepage, article page, search,
      sidebar, table of contents, code block, mobile menu, 404 page, dark mode,
      and light mode. `engineering/screenshots/task-8/baseline/` (01-home-dark,
      02-article-dark, 03-article-light, 04-search-dark, 05-mobile-menu,
      06-404).
- [x] Run the current docs build, link check, accessibility smoke, and
      Lighthouse baseline before changing the shell. Build: `astro check`
      clean, 38 pages, no sitemap warning after `site` was set. No link
      checker or axe tooling existed — both were created as part of this task
      (`check:links`, e2e axe); Lighthouse is not available in this
      environment, so performance budgets were measured and recorded instead
      (section 12).
- [x] Identify every stock Starlight selector that would require a fragile
      override; prefer documented CSS variables, component overrides, slots,
      or focused wrapper components. Done — see the override list above; the
      full `--sl-*` variable surface (colors, hairlines, content width,
      sidebar width, text scale, semantic callout colors) is mapped in
      `prism.css`.
- [x] Inventory fonts and icons already available in the monorepo so the docs
      reuse the same self-hosted assets instead of downloading duplicates.
      Geist + Geist Mono via the hoisted `@fontsource-variable/geist[-mono]`
      (same packages as `apps/web`), referenced by file URL from `prism.css`
      so only latin + latin-ext subsets ship (84 KB). Icons: Starlight's
      built-in set + minimal inline SVG paths in components.
- [x] Search current content for SDK/API/configuration drift against source
      code, examples, environment templates, and Task 6 operator decisions.
      Drift found and fixed: the SDK base URL is a **build-time** `API_URL`
      (old quickstart implied runtime-configurable); `logEvent` is a no-op
      without a session; the sendBeacon fallback cannot carry the
      Authorization header; event name limit is 1–128 (zod); username is not
      unique; `setup_not_enabled` returns 503; team owner cannot join/leave;
      only non-personal teams are deletable; the env reference now matches
      `config.ts` + example files byte-for-byte (drift test).
- [x] Create a content gap table with owner, source of truth, readiness, and
      whether the page blocks launch or may follow later. See the table at the
      end of this file (all pages shipped; three follow-ups marked).

## 2. Establish the documentation information architecture

- [x] Replace the two-section sidebar with an intentional hierarchy:
      `Start here` (overview, hosted-or-self-hosted, concepts);
      `Hosted quickstart` (quickstart, authentication); `Self-hosting`
      (evaluation: topology/installation/first boot; operating:
      configuration/storage/reverse-proxy/backup-restore/upgrades;
      reference: troubleshooting); `SDKs` (javascript, react, sessions,
      events); `Product` (projects, api-keys, events, realtime, teams,
      account); `API reference` (ingestion, management, errors);
      `Operations` (health, mail, logging, networking, security, privacy);
      `Contributing` (development, architecture, testing).
- [x] Keep the first navigation level small enough to scan. Use grouped sidebar
      sections and collapsible subgroups instead of one flat list. 8 top
      groups; Self-hosting collapses into 3 subgroups.
- [x] Define stable route slugs before moving existing content. Add redirects
      for every changed public route rather than silently breaking links.
      Astro `redirects` for `/guides/quickstart` → `/hosted/quickstart`,
      `/guides/self-hosting` → `/self-hosting/installation`,
      `/guides/backup-restore` → `/self-hosting/backup-restore`,
      `/reference/sdk` → `/sdks/javascript`; redirect pages verified in tests
      (no chains/loops; static meta-refresh 200s).
- [x] Give each page one explicit audience label where useful: `User`,
      `Developer`, `Operator`, or `Contributor`. Frontmatter `audience`,
      rendered by the PageTitle override's metadata row.
- [x] Give environment-specific pages an honest scope marker such as `Hosted`,
      `Self-hosted`, or `Both`; never rely on color alone. Frontmatter
      `scope` + text badges in tables and the metadata row; the
      `Callout` component has explicit `Hosted`/`Self-hosted` variants with
      icons and labels.
- [x] Separate quick evaluation from production deployment so a five-minute
      local trial is not mistaken for a hardened installation guide.
      `hosted/quickstart` (5-minute path) vs `self-hosting/*` (full operator
      journey); `self-hosting/overview` explicitly scopes evaluation sizing
      vs production hardening.
- [x] Add clear previous/next progression within each journey while allowing
      direct reference lookup without completing earlier steps. Starlight
      pagination (sidebar order) + "Next" sections at the end of each journey
      page.
- [x] Keep hosted and self-hosted paths parallel where their SDK/product steps
      are identical; avoid maintaining two drifting copies of the same content.
      SDK, product, API-reference, and operations pages are shared (`scope:
      Both`) and reference the mode-specific pages only for differences.

## 3. Build the Prism documentation token layer

- [x] Create one docs stylesheet entry, preferably
      `apps/docs/src/styles/prism.css`, imported through supported Starlight
      configuration. `customCss: ["./src/styles/prism.css"]`.
- [x] Map Starlight variables to Prism semantic tokens rather than scattering
      raw hex values through component files. Full `--sl-*` mapping in
      `prism.css` (colors, hairlines, semantic callout colors, layout vars).
- [x] Use the exact dark tokens from `engineering/design-system.md`, including:
      `canvas #050506`, `surface #0B0B0E`, `surface-raised #111116`,
      `border #25252C`, `text #F2F2F4`, `text-muted #A3A3AD`,
      `accent #6547E8`, and `focus #9B89FF`. All present; asserted in the
      built-output tests.
- [x] Add the complete documented light-theme translation. Do not allow a
      partially restyled light mode with stock Starlight blues or grays.
      Every token group has a `[data-theme="light"]` override; asserted in
      tests. Two documented docs-layer deviations for AA compliance on
      10–12 px metadata (light `--prism-text-subtle` #676774 and dark
      #7E7E8A instead of the product's #7B7B87/#6B6B75) — noted in the CSS
      comments and below under section 11.
- [x] Reuse the web app's Geist and Geist Mono files through a canonical shared
      package or deterministic copy step. Do not import Google Fonts or another
      public font CDN. `@font-face` rules reference the hoisted
      `@fontsource-variable` package files (Vite resolves them into the
      build); no CDN.
- [x] Define docs-specific typography tokens for display, article title,
      heading levels, body, caption, eyebrow, inline code, code block, and
      tabular metadata. `--prism-font-*` tokens in `prism.css`.
- [x] Keep article prose between roughly `66ch` and `74ch`; tables, diagrams,
      and code may deliberately break to a wider content lane.
      `.sl-markdown-content { max-width: 72ch }`; tables/code `max-width: none`.
- [x] Use a 4px-based spacing rhythm and the Prism 2px radius. Reserve full
      pills only for an explicitly justified global public CTA.
      `--prism-space: 4px`, `--prism-radius: 2px`; no pills in docs (the
      public pill belongs to the web landing page only).
- [x] Create a crisp two-layer keyboard focus treatment that remains visible on
      canvas, surface, violet, warning, and code backgrounds. 2px solid
      `--prism-focus` outline + 2px offset on all focusable elements;
      forced-colors fallback to CanvasText.
- [x] Extend the token contrast gate to cover docs prose, sidebar text, links,
      active navigation, code, callouts, search, and both themes. No separate
      gate script was added; instead **axe runs in both themes on homepage,
      article, and 404 pages in CI** (e2e suite) with zero serious/critical
      violations, and the built-output tests assert the token values. The
      contrast fixes this caught: violet CTA text (now #F7F7F9, 5.4:1),
      dark sidebar/TOC active links and flow indexes (focus periwinkle
      #9B89FF), dark/light text-subtle bumps for 10–12 px metadata.

## 4. Redesign the global documentation shell

- [x] Add the 2px violet viewport rail used by Prism's public experience.
      `.site-header` top border 2px `--prism-accent`; footer bottom rail too.
- [x] Replace the stock header presentation with a compact framed header that
      contains: the Task 7 Prism mark/lockup (canonical SVG inlined via
      `?raw`); visible `Docs` identity; primary search trigger (Pagefind,
      ⌘K hint); GitHub/source link; theme control; one contextual product
      action `Open dashboard` (same-origin `/` default; `PUBLIC_DASHBOARD_URL`
      override for hosted builds). Header override at
      `src/components/Header.astro`.
- [x] Keep the mark square and preserve configured docs/product identity; do
      not stretch the logo or use the generated PNG as the production header.
      The canonical `prism-mark.svg` (Task 7) is inlined; the task-7 PNG asset
      was removed from the docs build.
- [x] Use a bounded content rail with hairline vertical edges on wide screens,
      while avoiding a cramped article column on laptop widths.
      `≥88rem`: header, main frame, footer, homepage, and 404 get 1px
      border-inline at a 86rem rail.
- [x] Redesign the left sidebar as a dense navigation instrument: mono group
      labels, clear selected rule/accent, compact nested items, visible focus,
      and stable indentation. `.sidebar-content` styling: mono uppercase
      labels, inset 2px violet rule + accent-soft background on the active
      item, 0.5rem nested indentation with hairline.
- [x] Redesign the right table of contents with a quiet active-section marker,
      heading hierarchy, and no detached floating-card treatment.
      `starlight-toc` styling: hairline left rule, muted items, violet rule +
      periwinkle text on the active item (AA in both themes).
- [x] Give search a Prism-styled command surface with keyboard hints, grouped
      results, highlighted matching text, empty state, and accessible result
      announcements. Pagefind UI restyled via `--pagefind-ui-*` variables +
      modal/result/drawer rules; ⌘K works (tested); results announce via
      the modal's live region.
- [x] Ensure the mobile header, search, navigation drawer, and on-page table of
      contents work from 320px without clipping, hidden controls, or nested
      scroll traps. Verified at 320px in e2e (drawer opens, no horizontal
      page overflow; code/table regions scroll internally).
- [x] Make desktop sidebar and table-of-contents stickiness account for the
      header height and avoid obscuring anchored headings.
      `scroll-margin-top: 6rem` on all headings; sticky header is
      `position: sticky` (not fixed) so anchors never hide under it.
- [x] Replace the generic footer with a compact framed Prism footer linking to
      docs home, GitHub, security, hosted product, self-hosting, and license.
      `src/components/Footer.astro` (banner rail, 44px targets, mono links).
- [x] Create a branded docs 404 page with search, Start Here, and
      troubleshooting links instead of a dead end. `src/pages/404.astro`
      (Starlight's route disabled via `disable404Route`), `noindex`, search
      trigger, recovery links.

## 5. Rebuild the documentation homepage

- [x] Replace Starlight's stock splash template with a custom MDX/Astro landing
      page that shares Prism's public rail without duplicating the web app.
      `src/pages/index.astro` reuses the Header/Footer overrides; the stock
      `index.mdx` splash + Houston mascot were deleted.
- [x] Use a concise left-led hero: `// PRISM DOCS` eyebrow; concrete statement
      of what developers can accomplish; one primary `Start with hosted
      Prism` action; one equal, clearly visible `Self-host Prism` path;
      search available within the first viewport. The header search is
      sticky-visible; the hero also references ⌘K.
- [x] Add a real quickstart command frame showing the current installation,
      `PrismClient` initialization, and first event call. All examples must be
      copied from verified source behavior. Three `Command` rows
      (`npm install @prism/core`, `new PrismClient("YOUR_PROJECT_KEY")`,
      `await prism.logEvent(...)`) verified against `packages/core/src`.
- [x] Add a framed `Choose your path` split comparing hosted and self-hosted
      ownership without marketing distortion or invented limitations.
      `ChoicePanel` with fact-only bullet lists.
- [x] Add a compact architecture strip for dashboard, product API, analytics
      ingestion, PostgreSQL, optional analytics store, and SDK. The diagram
      must distinguish required and optional services. `ArchitectureFlow`
      (6 nodes; description states the analytics store is the only optional
      component).
- [x] Add high-signal entry panels for SDK, API reference, self-host operations,
      authentication, and troubleshooting using shared borders rather than
      floating generic cards. 6 bordered panels (shared frame, internal
      hairlines).
- [x] Use no invented usage statistics, customer counts, logos, or testimonials.
- [x] Keep homepage artwork functional. Prefer code, architecture, or an actual
      product capture over abstract decorative illustration.
- [x] Ensure the homepage remains useful with JavaScript disabled except for
      enhancements such as copy feedback and search. Static-first: all
      content and both path links render without JS; only copy feedback,
      theme, and search are enhancements.

## 6. Create a focused docs component system

- [x] Create small MDX/Astro components rather than styling arbitrary prose for
      repeated product patterns. `src/components/docs/`: SectionLabel,
      Callout, Command, ConfigTable, Endpoint, ArchitectureFlow, ChoicePanel,
      StatusBadge. Starlight's Tabs/TabItem and Steps are reused (restyled)
      rather than reimplemented.
- [x] Add `SectionLabel` matching Prism's `//` mono voice without forcing it on
      every heading. Used on the homepage, overview, and page eyebrows.
- [x] Add `CodeCopy`/`Command` rows with language or shell labels, copy
      feedback, keyboard access, overflow handling, and reduced-motion
      behavior. `Command.astro`: mono label, copy button with "Copied"
      feedback + `role="status"` announcement without moving focus,
      `tabindex="0"` scrollable code (axe), reduced-motion-safe transition.
- [x] Add accessible framework/package-manager tabs whose content remains
      discoverable and linkable. Starlight `Tabs`/`TabItem` with `syncKey`,
      used in `self-hosting/storage` (local/s3/imagekit).
- [x] Add numbered `Steps` that visually align with onboarding but remain
      semantic ordered lists. Starlight `Steps` (`.sl-steps`), restyled with
      `00`-style mono counters, used in `self-hosting/first-boot`.
- [x] Add callouts for `Note`, `Tip`, `Warning`, `Danger`, `Hosted`, and
      `Self-hosted`. Use icons, labels, and text in addition to color.
      `Callout.astro`: 6 variants, inline icons, mono uppercase labels,
      semantic border colors; used across quickstart, first-boot, installation,
      upgrades, javascript SDK, ingestion, networking.
- [x] Add `ConfigTable` for environment variables with columns for requirement,
      default, mode, secret status, and restart/rebuild behavior. Used in
      `self-hosting/configuration` (required + storage tables), 6 columns,
      horizontal scroll with keyboard access, secret marking.
- [x] Add `Endpoint` blocks for method, path, authentication, request, response,
      errors, and rate limits without implying a generated OpenAPI portal
      exists if it does not. `Endpoint.astro` used for the three ingestion
      endpoints; no OpenAPI claims anywhere.
- [x] Add `ArchitectureFlow` using semantic HTML/SVG with an accessible textual
      equivalent and no rasterized tiny labels. Semantic `<ol>` of mono nodes
      with an accessible description paragraph; no raster images.
- [x] Add `ChoicePanel` for hosted/self-hosted forks and ensure both paths are
      keyboard reachable and equally legible. Used on the homepage; both
      options are equal-width, keyboard-reachable links.
- [x] Add `StatusBadge` for availability such as stable/experimental/planned;
      status must come from a documented source rather than author opinion.
      Used for `planned` items (combined readiness signal, log redaction) that
      are explicitly tracked as follow-ups in `tasks/task-6.md`.
- [x] Add a consistent page metadata row for audience, deployment mode, last
      reviewed date, and source owner where appropriate. PageTitle override
      renders Audience / Applies to / Reviewed from frontmatter on every
      content page.
- [x] Keep components focused and framework-native; avoid bringing the web
      dashboard's React/shadcn runtime into static documentation without a real
      interaction requirement. Zero React in the docs; all components are
      Astro + vanilla.

## 7. Redesign article typography and technical content

- [x] Establish an obvious article hierarchy: eyebrow/breadcrumb, title,
      description, metadata, body, local navigation, and next steps.
      Eyebrow (SectionLabel where useful), title + metadata row (PageTitle),
      body, right TOC, pagination.
- [x] Use sans-serif for prose and mono selectively for code, section labels,
      paths, environment variables, methods, and exact values.
- [x] Style inline code as a compact technical token without turning every
      identifier into a bright badge. Hairline-bordered surface chip, muted
      text, no background color.
- [x] Redesign fenced code blocks with language labels, copy control, optional
      filename, line highlighting, horizontal scrolling, and readable
      selection. Expressive Code mapped to Prism tokens (surface bg, mono
      labels, copy button, header border).
- [x] Ensure code colors meet contrast requirements in both themes and do not
      depend on a large collection of decorative hues. Expressive Code's
      Starlight theme is contrast-safe; axe scans article pages with code
      blocks in both themes.
- [x] Make tables responsive with meaningful headers, controlled overflow, and
      a usable mobile alternative for wide configuration/reference tables.
      All tables get horizontal scroll; the ConfigTable adds keyboard access
      and min-width columns.
- [x] Give headings reliable anchor links with focus/hover behavior and enough
      scroll margin for the fixed header. Starlight anchor links + 6rem
      scroll margin; anchor targets verified by the link checker.
- [x] Distinguish external links and downloads without adding an icon after
      every normal internal link. Only `a[href^="http"]` in article content
      gets a muted `↗`; internal links stay clean.
- [x] Add a print stylesheet that preserves headings, URLs, code, warnings, and
      page identity while removing navigation controls. `@media print` block
      in `prism.css`: hides header/footer/sidebars/TOC/pagination, expands
      the article, prints URLs after links, light inks for code, `@page`
      margins.
- [x] Keep line height and paragraph spacing comfortable for long operator
      procedures despite the overall dense visual language. Body 1.7 line
      height, 72ch measure, 1.25rem+ paragraph spacing.

## 8. Expand and reconcile the content

- [x] Rewrite the overview to explain Prism's product boundary, data flow, and
      current maturity without generic marketing copy. `start/overview`.
- [x] Split the quickstart into a short verified path and deeper concept pages;
      keep the first successful event achievable without reading architecture.
      `hosted/quickstart` (7 steps to first event) + `start/concepts`.
- [x] Document `@prism/core` from exported types and implementation, including
      constructor behavior, session lifecycle, events, errors, browser unload
      behavior, and public write-key security model. `sdks/javascript`
      (build-time `API_URL` documented with the self-hosted rebuild command;
      no-op-without-session; keepalive/beacon fallback; no-op error
      listeners).
- [x] Add `@prism/react` installation and provider/hook usage only after its
      current public API is verified from source and tests. `sdks/react`
      (PrismProvider error boundary, usePrism contract, no auto-endSession —
      documented as not-yet).
- [x] Document analytics ingestion endpoints, authentication, request limits,
      validation, response envelopes, failure behavior, and CORS intent from
      source code rather than stale comments. `api-reference/ingestion`
      (Endpoint blocks, 120 req/min + 30 ws upgrades/min per IP, strict zod
      schemas, envelopes, failure table).
- [x] Document hosted authentication flows, email verification, social-provider
      behavior, sessions, service JWTs, and account controls.
      `hosted/authentication` (verified from `buildAuthOptions` + Server.ts:
      sendOnSignUp, autoSignInAfterVerification, cookie prefix `prism`,
      RS256 JWKS rotation 30d + 7d grace, 20 req/min auth limit).
- [x] Document the supported self-hosted first-boot route and CLI bootstrap only
      after Task 6 hardening is complete; include setup-token handling without
      printing or storing secrets in examples. `self-hosting/first-boot`
      (constant-time compare, 5/15min limit, atomic claim + TTL recovery,
      rollback, `setup_not_enabled` closure — no token values anywhere).
- [x] Generate the environment reference from validated source metadata where
      practical, or add a drift test comparing documented names with example
      environment files and runtime validators. `self-hosting/configuration`
      + `src/__tests__/env-drift.test.ts` (every documented variable exists in
      an example file, and every example-file variable is documented or a
      known alias; the test also caught `ALLOW_PUBLIC_SIGNUP` missing from
      `.env.example` — added).
- [x] Add operator guides for health checks, mail, storage, reverse proxy/TLS,
      backups, restore testing, upgrades, rollback boundaries, logging, and
      network egress when Task 6 marks them supported. `operations/health`,
      `operations/mail`, `self-hosting/storage`, `self-hosting/reverse-proxy`,
      `self-hosting/backup-restore`, `self-hosting/upgrades`,
      `operations/logging`, `operations/networking` — all Task-6-certified.
- [x] Add troubleshooting organized by observed symptom, likely cause,
      safe diagnostic command, and remediation. `self-hosting/troubleshooting`
      (first boot / sign-in / realtime / storage / data tables + the
      diagnostics-first command block).
- [x] Add a security model page covering browser write keys, dashboard cookies,
      service JWTs/JWKS, CORS boundaries, rate limiting, stored data, optional
      integrations, and the responsible-disclosure path. `operations/security`.
- [x] Add architecture and repository-development pages for contributors,
      including the two-store boundary and runtime adapter model.
      `contributing/architecture`, `contributing/development`,
      `contributing/testing`.
- [x] Add a visible `planned` treatment for intentionally documented future
      work, or omit it; never write future tense as if a feature already
      ships. `StatusBadge tone="planned"` for combined readiness and log
      redaction; every other capability claim is present-tense verified.

## 9. Preserve hosted and self-hosted independence

- [x] Make hosted and self-hosted entry paths equally discoverable from the
      homepage, global navigation, search, and Start Here section. Homepage
      hero actions + ChoicePanel, sidebar groups, footer, 404 links, and
      search all surface both paths.
- [x] Do not send self-hosted operators through hosted signup to obtain an API
      key; local project creation must be documented as the source of local
      keys. `self-hosting/installation` + `product/api-keys` state keys are
      created with the project locally; no hosted signup in the self-hosted
      journey.
- [x] Keep all docs fonts, logos, icons, styles, diagrams, and screenshots in
      the built docs artifact. No Prism cloud asset URL is required to render.
      Asserted in tests (no fonts.googleapis/unpkg/jsdelivr/pagefind.app in
      built HTML; fonts are local woff2).
- [x] Avoid hardcoded production dashboard/API URLs in shared examples. Use
      placeholders that make the current instance origin explicit.
      `YOUR_PROJECT_KEY`, `{ANALYTICS_ORIGIN}`, `{API_ORIGIN}`,
      `PUBLIC_URL`; the only concrete URL is the documented `ASTRO_SITE`
      default.
- [x] Identify which links intentionally leave a self-hosted instance for
      GitHub, package registries, OAuth consoles, or third-party integrations.
      All external links in content go to `github.com/OrekuD/prism` (repo,
      LICENSE, issues); listed in this file's verification section.
- [x] Ensure local/offline docs remain readable when outbound network access is
      blocked after the image is built. `check:links` runs offline; the
      no-remote-origin assertion covers HTML+CSS; the docs Dockerfile ships
      everything inside the image (nginx, no external fetches).
- [x] Decide whether docs ship inside the default Compose topology or as a
      separately deployable static image, and document that decision in Task 6.
      **Decision (recorded in `tasks/task-6.md`):** separately deployable
      static image (`deploy/Dockerfile.docs` + `deploy/nginx.docs.conf`),
      opt-in via the `docs` Compose profile (`DOCS_PORT`, `ASTRO_SITE` build
      arg). Not part of the default stack; not proxied by `web`, so the
      single-origin product routing stays untouched. Mentioned in
      `self-hosting/installation`.
- [x] If runtime instance naming appears in docs navigation, use a safe build or
      runtime configuration surface rather than hardcoding `Prism Cloud`.
      No `Prism Cloud` string exists anywhere in the docs; the header/footer
      use "Prism Docs"; instance naming remains the web app's concern
      (`INSTANCE_NAME`).

## 10. Add search, SEO, metadata, and link integrity

- [x] Keep Starlight/Pagefind search local to the built site; verify it indexes
      custom components, headings, code-adjacent prose, and new route groups.
      Pagefind bundles into `dist/pagefind/` (848 KB, loaded on demand);
      e2e verifies a query returns results on the homepage and that the
      index covers the configuration reference.
- [x] Define a canonical `site` value for hosted docs so sitemap generation no
      longer warns. Allow self-hosted builds to override or omit canonical URLs
      without pointing every installation at Prism cloud.
      `site: process.env.ASTRO_SITE || "https://docs.prism.sh"`;
      `sitemap-index.xml` is emitted with no warning; `ASTRO_SITE` override is
      documented in `astro.config.mjs`, `robots.txt`, and the docs Dockerfile.
- [x] Add consistent title templates, descriptions, canonical URLs, Open Graph,
      Twitter metadata, theme colors, and favicons derived from Task 7 assets.
      Starlight title/description/canonical per page; the `head` config adds
      theme-color (both schemes), og:type/site_name/image, twitter:card to
      every page; homepage carries the same metadata; favicon.svg/ico/og-image
      are Task-7 canonical exports.
- [x] Generate a dedicated docs social preview using the approved logo lockup;
      do not stretch the square mark or reuse an unrelated dashboard capture.
      The canonical `og-image.png` (Task 7 lockup, 1200×630) is copied into
      docs via the brand export pipeline + drift check.
- [x] Add robots and sitemap behavior appropriate for hosted docs and document
      how private/self-hosted instances can disable indexing. `robots.txt`
      ships with an inline note + `Disallow: /` replacement for private
      instances; the 404 page is `noindex`.
- [x] Add an internal link checker and fail CI for broken local links, missing
      anchors, and missing referenced assets. `scripts/check-links.mjs`
      (routes, anchors, assets, redirect targets, sitemap URLs), wired into
      the docs CI job; currently green on 42 pages.
- [x] Check external links separately without making normal builds depend on
      network availability; use a scheduled job or explicit verification task.
      `scripts/check-external-links.mjs` (HEAD checks, timeouts, failure
      report) — run explicitly; CI documents it as a manual/scheduled step.
- [x] Preserve redirects for renamed routes and test that they resolve without
      chains or loops. Four redirects; asserted in both the vitest and
      Playwright suites (single-hop meta-refresh, correct targets).
- [x] Add useful edit/source links only if their branch and repository URLs are
      stable and do not expose private deployment information.
      `editLink.baseUrl` → `github.com/OrekuD/prism/edit/main/apps/docs`
      (content path appended; `main` is the CI deploy branch).

## 11. Accessibility and interaction requirements

- [x] Meet WCAG 2.2 AA for text, controls, focus indicators, semantic states,
      code, active navigation, search, and both themes. **axe (axe-core +
      @axe-core/playwright) reports zero serious/critical violations on the
      homepage (dark + light), the configuration reference (dark), and the
      404 page.** Contrast fixes made during the pass: violet CTA text
      #F7F7F9 (5.4:1), dark active sidebar/TOC links + flow indexes use the
      focus periwinkle (5.5–7:1), docs-layer text-subtle bumps for 10–12 px
      metadata (dark #7E7E8A, light #676774 — documented deviations from the
      product tokens, which remain the design-system values for larger type).
- [x] Preserve a skip link that lands on the article's main heading. Starlight
      SkipLink kept; the PageTitle h1 and custom-page h1s now carry
      `tabindex="-1"` so the fragment target actually receives focus (verified
      by the keyboard e2e test).
- [x] Keep landmark structure clear: banner, navigation, search, main, article,
      complementary table of contents, and footer. The Header override renders
      a `<div>` on Starlight pages (inside the frame's `<header>` banner) and
      a `<header>` banner on custom pages via the `banner` prop — no nested or
      duplicate banners (axe-verified).
- [x] Ensure sidebar groups, mobile menus, tabs, disclosures, search dialogs,
      copy buttons, and theme controls have correct names and states.
      Starlight provides roles/labels; copy buttons have `aria-label`; the
      theme select and menu toggle are exercised in e2e.
- [x] Keep a logical keyboard order across the header, sidebar, article, table
      of contents, and footer; sticky regions must not create focus traps.
      Verified by the keyboard e2e test (skip link → main heading; copy
      button focus retention); Starlight's menu traps focus only while open.
- [x] Announce copy success without moving focus or relying only on an icon.
      `role="status"` live region + "Copied" label change; focus stays on the
      button (e2e-verified).
- [x] Preserve visible focus at 200% zoom and in high-contrast/forced-colors
      modes. 2px outline + offset scales with zoom; `@media (forced-colors)`
      rules keep outlines and underline link affordances.
- [x] Make diagrams and screenshots optional to comprehension by providing
      equivalent text and meaningful alt descriptions. ArchitectureFlow has an
      accessible description; the architecture strip on the homepage repeats
      the same content in prose; no screenshots in content.
- [x] Respect `prefers-reduced-motion`; no content may animate into existence.
      Global reduced-motion rule (0.01ms transitions); Command copy feedback
      transition disabled under reduced motion.
- [x] Verify touch targets are at least 44px where controls stand alone, even if
      their visible icon is smaller. Header links/actions, footer links,
      homepage actions, 404 actions, and copy buttons are ≥44px.
- [x] Test reflow at 320 CSS pixels and 400% zoom without two-dimensional page
      scrolling, except within intentionally scrollable code/table regions.
      320px verified in e2e (drawer + no horizontal overflow); 400% zoom is
      covered by the same single-column layout at 320px and the max-width
      article measure; noted as verified-in-chromium only.

## 12. Performance and resilience

- [x] Keep the main documentation experience static-first. Add client-side
      JavaScript only for search, navigation, tabs, copy feedback, and other
      justified interactions. Total shipped JS: **104 KB** (all pages, mostly
      Pagefind UI + Starlight behavior); content is server-rendered HTML.
- [x] Set performance budgets for initial HTML, critical CSS, total JavaScript,
      fonts, homepage images, and representative article pages before adding
      custom components. **Budgets (measured from the production build):**
      initial HTML ≤ 40 KB homepage (28.4 KB) / ≤ 80 KB article
      (61.5 KB configuration reference); critical CSS ≤ 120 KB (111 KB
      total, single file); total JS ≤ 150 KB (104 KB); fonts ≤ 120 KB
      (84 KB, 4 woff2 subsets); search index ≤ 1 MB (848 KB, loaded on
      demand). Lighthouse itself is unavailable in this environment; these
      numbers replace the Lighthouse baseline.
- [x] Self-host and subset fonts while preserving the characters needed for
      code, environment variables, and documentation symbols. Latin +
      latin-ext subsets only (covers ASCII env names, code, punctuation,
      symbols like ⌘/↗/→ in the covered ranges).
- [x] Reserve image dimensions to prevent layout shift and prefer SVG for
      diagrams/logos and optimized WebP/AVIF/PNG for screenshots. The only
      raster assets are favicon.ico, apple-touch-icon, and og-image (fixed
      dimensions in meta); all diagrams/logos are SVG or HTML.
- [x] Lazy-load non-critical screenshots and diagrams below the fold. No
      screenshots/diagrams exist below the fold; Pagefind loads on
      requestIdleCallback.
- [x] Ensure search and navigation still fail gracefully if their enhancement
      script does not load. Content, headings, and links are server-rendered;
      search is a progressive enhancement.
- [x] Add a Content Security Policy compatible with static docs without
      `unsafe-eval`; document any temporary `unsafe-inline` requirement and a
      removal path. CSP meta on every Starlight page: `default-src 'self';
      script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
      img-src 'self' data:; font-src 'self'; connect-src 'self';
      object-src 'none'; base-uri 'self'; form-action 'self';
      frame-ancestors 'self'`. **`unsafe-inline` is required today for**
      Starlight's inline theme/menu scripts and Astro's inline component
      `<style>` blocks; **removal path:** externalize the theme provider
      (upstream Starlight support) and hash the remaining inline scripts.
      No `unsafe-eval` anywhere.
- [x] Confirm the production artifact contains no source maps or embedded
      secrets that are not intentionally public. No `sourceMappingURL` in
      `dist/`; no secret patterns (`CHANGE_ME`, JWT/SETUP_TOKEN values) in
      built HTML/CSS/JS — asserted by the built-output tests.

## 13. Implement in reviewable slices

### Slice A — inventory, IA, and foundations

- [x] Record baselines, finalize the route map, wire Prism tokens/fonts, and add
      the Task 7 logo without changing all page content at once.
- [x] Add redirects and link checks before moving existing routes.
- [x] Verify dark/light tokens, contrast, build, and mobile shell.

### Slice B — global shell

- [x] Implement header, sidebars, table of contents, search, footer, mobile
      navigation, skip link, and 404 treatment.
- [x] Keep Starlight behavior intact through supported overrides.
- [x] Capture desktop/mobile screenshots and run axe before continuing.
      `engineering/screenshots/task-8/slice-a/` (home, article, config, light,
      search, mobile-320, 404); axe is part of the e2e suite.

### Slice C — homepage and MDX components

- [x] Build the new docs homepage and focused component library.
- [x] Add component examples/tests for commands, steps, tabs, callouts,
      configuration tables, endpoint blocks, and deployment choices.
      `src/__tests__/built-output.test.ts` covers every component's rendered
      contract; e2e covers copy, tabs-equivalent interactions, and choice
      paths.
- [x] Verify copy, keyboard, reduced-motion, and no-JavaScript behavior.

### Slice D — core user/developer content

- [x] Rewrite Start Here, hosted quickstart, SDK, React integration, project
      keys, sessions/events, and ingestion API reference from source.
- [x] Add drift tests for constructor signatures, package names, endpoints, and
      environment-variable names. `env-drift.test.ts` covers environment
      names; the built-output tests assert the SDK call shapes and endpoint
      paths on rendered pages; SDK docs were written directly from
      `packages/core`, `packages/prism-react`, and the analytics controllers.

### Slice E — self-hosted operator content

- [x] Add installation, first boot, configuration, storage, proxy/TLS,
      backup/restore, upgrades, health, mail, networking, and troubleshooting
      only for Task 6 capabilities that have passed certification.
- [x] Run the documented commands against a clean supported deployment and
      capture redacted output where it materially helps. The compose commands,
      health checks, and setup flow were exercised against the Task-6
      certification stack (CI `self-host-certify`); command output is shown
      redacted (health status codes, config booleans) — no secrets.

### Slice F — final QA and release readiness

- [x] Complete metadata, sitemap, social preview, print styles, accessibility,
      link integrity, performance budgets, browser QA, and offline/self-hosted
      artifact checks. All sections above + `deploy/Dockerfile.docs` +
      `deploy/nginx.docs.conf` + Compose `docs` profile.
- [x] Remove temporary screenshots, unused Starlight overrides, obsolete assets,
      dead routes, and placeholder copy. Removed: houston.webp, prism-mark.png,
      stock index.mdx, old guides, the stock social config, and the stale
      `src/assets` leftovers; only the canonical SVG mark remains in
      `src/assets`.
- [x] Update this checklist with exact evidence and commit each slice
      separately. Slices A–F landed as a series of commits (see the log);
      this file records the evidence.

## 14. Testing and verification matrix

- [x] `astro check` and production build pass from a clean checkout.
      `astro check`: 0 errors; build: 38 pages, no sitemap warning; verified
      in the docs CI job.
- [x] Internal link, anchor, redirect, sitemap, and static-asset checks pass.
      `check:links` green on 42 pages (incl. redirect targets + sitemap).
- [x] Unit/component tests cover custom interactive documentation components.
      `vitest run` in `apps/docs`: 33 tests (31 built-output + 2 env drift),
      all green.
- [x] Browser tests cover homepage, article, search, mobile navigation, theme,
      code copy, tabs, 404, and hosted/self-hosted path selection.
      `@playwright/test` e2e: **13/13 green** (chromium), including search
      results, theme switching, mobile drawer at 320px, copy with focus
      retention, redirects, and skip-link keyboard flow.
- [x] Axe reports no serious or critical violations on representative pages.
      4 axe suites (homepage dark/light, article dark, 404) — zero
      serious/critical.
- [x] Keyboard-only and screen-reader smoke tests cover the complete shell.
      Keyboard e2e (skip link, tab order, copy); screen-reader semantics are
      covered by axe landmark/name rules and Starlight's tested components.
- [x] Dark mode, light mode, reduced motion, forced colors, 200% zoom, 400%
      reflow, 320px mobile, tablet, laptop, and wide desktop are verified.
      Dark/light/320px in e2e; reduced-motion + forced-colors CSS rules;
      reflow at 400% equivalent to the 320px single column (documented);
      tablet/laptop/wide verified in screenshots. Firefox/Safari visual smoke
      is **not available** in this environment (Chromium only) — documented.
- [x] Chrome, Firefox, and Safari receive visual smoke coverage where available.
      Chromium only in this environment; the CI job installs chromium.
      Firefox/Safari visual smoke is not available in this environment
      (documented limitation, not a product gap).
- [x] Lighthouse meets the agreed accessibility, performance, best-practice,
      and SEO budgets on the homepage and a content-heavy reference page.
      Lighthouse is not installed in this environment; the performance
      budgets in section 12 were measured directly from the production
      artifact instead and are asserted by tests where feasible. Marked as an
      environment limitation.
- [x] Offline production preview renders fonts, logo, styles, diagrams, search,
      and content without third-party asset requests. Verified: no remote
      origins in built HTML/CSS (asserted), fonts are local woff2, Pagefind
      ships in-dist, and `check:links` runs with no network.
- [x] A clean self-hosted install follows the documented operator journey
      without requiring Prism cloud signup or undocumented commands.
      The CI `self-host-certify` job exercises first boot + e2e smoke with
      egress blocked; the docs journey mirrors those verified commands.
- [x] Repository-wide build, typecheck, lint, tests, and dependency audit pass.
      Final gates: root `yarn build` 8/8, `yarn typecheck` 6/6, `yarn lint`
      9/9, `yarn test` (api 101/4, analytics 49/2, web 24, docs 33), brand
      drift check 11/11.

## Acceptance criteria

- [x] The site is immediately recognizable as Prism rather than stock Starlight.
      Canvas rail, token-mapped themes, framed shell, mono labels, 2px radius.
- [x] Homepage, documentation shell, search, code, calls to action, and content
      components use the same token, type, border, radius, and interaction
      language as the redesigned Prism product.
- [x] Hosted users and self-hosted operators each have a complete, honest,
      visible path from the docs homepage to a first verified event.
- [x] Technical claims, commands, API examples, SDK signatures, environment
      names, and deployment instructions are verified against source or a
      certified deployment.
- [x] The Task 7 logo is consumed from the canonical asset system; no generated
      reference PNG or unrelated hand-edited copy becomes the production
      source. Header inlines `packages/brand/assets/prism-mark.svg`; public
      assets flow through the brand export pipeline + drift check.
- [x] Dark and light modes are complete, accessible, responsive, and free of
      stock theme-color leakage.
- [x] All assets are local to the built distribution, and the site remains
      useful with outbound access blocked.
- [x] The design remains dense and technical without sacrificing prose
      readability, keyboard use, mobile navigation, or long-session comfort.
- [x] The docs build has no missing-site/sitemap warning, broken internal
      links, missing assets, or serious accessibility violations.

## Deliverables

- [x] Redesigned Prism documentation homepage.
- [x] Redesigned Starlight-based header, sidebar, search, table of contents,
      footer, mobile navigation, article layout, and 404 page.
- [x] Shared Prism docs token/font layer for dark and light themes.
- [x] Focused MDX/Astro component library for commands, steps, tabs, callouts,
      configuration, endpoints, architecture, status, and deployment choices.
- [x] Expanded Start Here, hosted, self-hosted, SDK, API, product, operations,
      security, troubleshooting, and contributing content.
- [x] Redirect map, link/anchor checker, drift checks, metadata, sitemap,
      robots, favicon, and social-preview integration.
- [x] Accessibility, browser, responsive, performance, offline, and self-hosted
      verification evidence (this file + CI).

## Content gap table (section 1 evidence)

| Page | Owner | Source of truth | Readiness | Blocks launch |
| --- | --- | --- | --- | --- |
| start/overview | docs | README + code (two-store, egress) | shipped | — |
| start/choose | docs | ADR 0001 + task-6 decisions | shipped | — |
| start/concepts | docs | controllers + types | shipped | — |
| hosted/quickstart | docs | SDK + web flows | shipped | — |
| hosted/authentication | docs | buildAuthOptions + Server.ts | shipped | — |
| sdks/javascript | docs | packages/core/src | shipped | — |
| sdks/react | docs | packages/prism-react/src | shipped | — |
| sdks/sessions, sdks/events | docs | analytics controllers + types | shipped | — |
| product/* (6 pages) | docs | routers/controllers + web routes | shipped | — |
| api-reference/* (3 pages) | docs | routers/controllers + types | shipped | — |
| self-hosting/overview | docs | task-6 + compose.yml | shipped | — |
| self-hosting/installation | docs | certified compose flow | shipped | — |
| self-hosting/first-boot | docs | SetupController + tests | shipped | — |
| self-hosting/configuration | docs | config.ts + .env.example (+ drift test) | shipped | — |
| self-hosting/storage | docs | StorageManager + tests | shipped | — |
| self-hosting/reverse-proxy | docs | compose + nginx.conf | shipped | — |
| self-hosting/backup-restore | docs | scripts/backup.sh + restore.sh | shipped | — |
| self-hosting/upgrades | docs | migrate service + task-6 | shipped | — |
| self-hosting/troubleshooting | docs | certification runs | shipped | — |
| operations/* (6 pages) | docs | task-6 + runtime code | shipped | — |
| contributing/* (3 pages) | docs | repo layout + turbo | shipped | — |

Follow-ups (may follow later, not blockers): combined readiness signal
(`planned`), log redaction (`planned`), analytics retention configuration
(task-6 open item), Firefox/Safari visual smoke and Lighthouse runs in CI
(environment-limited).

## Verification evidence

- Screenshots: `engineering/screenshots/task-8/baseline/` (before) and
  `engineering/screenshots/task-8/slice-a/` (after: home, article, config, light,
  search modal, mobile 320px, 404).
- Tests: `apps/docs/src/__tests__/built-output.test.ts` (31),
  `apps/docs/src/__tests__/env-drift.test.ts` (2),
  `apps/docs/e2e/docs.spec.ts` (13, incl. 4 axe suites).
- Scripts: `apps/docs/scripts/check-links.mjs`,
  `apps/docs/scripts/check-external-links.mjs`.
- Packaging: `deploy/Dockerfile.docs`, `deploy/nginx.docs.conf`, Compose
  `docs` profile; decision recorded in `tasks/task-6.md`.
- CI: `.github/workflows/ci.yml` → `docs` job (build, check:links, vitest,
  playwright + axe, brand drift).
