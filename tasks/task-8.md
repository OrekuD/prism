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
[`docs/design-system.md`](../docs/design-system.md). Logo work comes from
[`tasks/task-7.md`](./task-7.md), and self-hosting/runtime facts come from
[`tasks/task-6.md`](./task-6.md). Do not duplicate or contradict those sources.

## Status

Planned. Begin implementation after Task 7 has produced the canonical SVG logo
and Task 6 has settled the supported self-hosted topology, commands, and
environment contract. Content inventory and component prototyping may happen
earlier, but do not publish deployment instructions that describe unfinished
packaging as complete.

## Current state

- `apps/docs` uses Astro 7, Starlight 0.41, and MDX.
- The site contains only a splash page, one quickstart, and one SDK reference.
- Navigation, header, sidebar, search, typography, cards, code blocks, footer,
  and mobile behavior are predominantly stock Starlight.
- The homepage uses Starlight's generic splash hero and card grid rather than
  the Prism public-page rail and framed developer workflow.
- The current information architecture does not yet explain hosted versus
  self-hosted setup, runtime services, deployment, configuration, backups,
  upgrades, authentication, analytics ingestion, or operations.
- The docs build warns because Astro's canonical `site` value is not set.
- The current favicon is temporary and must be replaced through Task 7's
  canonical brand export process.
- All documentation assets must work offline inside a self-hosted distribution;
  no runtime font, logo, image, or stylesheet may depend on a third-party host.

## Design direction

The documentation should feel like an instrument panel for understanding and
operating Prism: compact, explicit, inspectable, and calm.

Design dials:

- `DESIGN_VARIANCE: 6` — recognizable documentation patterns inside a more
  original framed Prism shell.
- `MOTION_INTENSITY: 2` — short interaction feedback only; documentation must
  never make users wait for decorative reveals.
- `VISUAL_DENSITY: 7` — technical and compact, with strong hierarchy and a
  readable article measure.

Required characteristics:

- canonical dark canvas `#050506`, with a complete light-token translation;
- 2px solid violet top rail using `#6547E8`;
- self-hosted Geist and Geist Mono typography shared with the web app;
- one-pixel borders, framed rails, sharp 2px control radius, and sparse
  registration details;
- mono uppercase section labels and metadata, sans-serif prose, mono code;
- compact, real code and command examples as primary interaction surfaces;
- Prism violet only for brand/action/selection; semantic colors only for real
  success, warning, danger, informational, or event meaning;
- deliberate dark/light support from the same semantic token system;
- no glassmorphism, glow, decorative gradients, floating rounded card stacks,
  fake terminal chrome, giant empty heroes, or generic purple blobs.

Use the Command Code references only for discipline, density, hairline
structure, and developer-focused presentation. Do not copy its logo, custom
lettering, page compositions, copy, mascot, illustrations, or proprietary UI.

## Non-goals

- Do not replace Astro/Starlight with a bespoke documentation framework unless
  a demonstrated blocker makes the existing framework unsuitable.
- Do not fork Starlight or copy large pieces of its internals when supported
  component overrides and CSS hooks can achieve the result.
- Do not document unfinished features as available.
- Do not invent SDK methods, API responses, environment variables, performance
  numbers, supported deployment targets, or security guarantees.
- Do not make hosted signup the only route through the docs.
- Do not add an account requirement to read documentation.
- Do not add remote analytics by default. Any future docs analytics must be
  explicit, documented, and disabled in self-hosted builds unless the operator
  opts in.
- Do not turn this task into a redesign of the dashboard or public landing page.

## 1. Audit the existing documentation surface

- [ ] Inventory every route, MD/MDX file, static asset, Starlight configuration
      option, integration, and custom style currently present in `apps/docs`.
- [ ] Record the current Astro/Starlight versions and inspect the supported
      component-override API before designing around internal DOM selectors.
- [ ] Capture baseline screenshots of the homepage, article page, search,
      sidebar, table of contents, code block, mobile menu, 404 page, dark mode,
      and light mode.
- [ ] Run the current docs build, link check, accessibility smoke, and
      Lighthouse baseline before changing the shell.
- [ ] Identify every stock Starlight selector that would require a fragile
      override; prefer documented CSS variables, component overrides, slots,
      or focused wrapper components.
- [ ] Inventory fonts and icons already available in the monorepo so the docs
      reuse the same self-hosted assets instead of downloading duplicates.
- [ ] Search current content for SDK/API/configuration drift against source
      code, examples, environment templates, and Task 6 operator decisions.
- [ ] Create a content gap table with owner, source of truth, readiness, and
      whether the page blocks launch or may follow later.

## 2. Establish the documentation information architecture

- [ ] Replace the two-section sidebar with an intentional hierarchy:
      - `Start here` — overview, choose hosted/self-hosted, concepts;
      - `Hosted quickstart` — account, project, key, SDK, first event;
      - `Self-hosting` — evaluation, installation, first boot, configuration,
        storage, reverse proxy/TLS, backup/restore, upgrade, troubleshooting;
      - `SDKs` — JavaScript core, React integration, sessions, events, errors;
      - `Product` — projects, API keys, events, realtime, teams, account;
      - `API reference` — ingestion and authenticated management boundaries;
      - `Operations` — health checks, logs, mail, storage, networking,
        observability, privacy, security model;
      - `Contributing` — local development, repository architecture, tests.
- [ ] Keep the first navigation level small enough to scan. Use grouped sidebar
      sections and collapsible subgroups instead of one flat list.
- [ ] Define stable route slugs before moving existing content. Add redirects
      for every changed public route rather than silently breaking links.
- [ ] Give each page one explicit audience label where useful: `User`,
      `Developer`, `Operator`, or `Contributor`.
- [ ] Give environment-specific pages an honest scope marker such as `Hosted`,
      `Self-hosted`, or `Both`; never rely on color alone.
- [ ] Separate quick evaluation from production deployment so a five-minute
      local trial is not mistaken for a hardened installation guide.
- [ ] Add clear previous/next progression within each journey while allowing
      direct reference lookup without completing earlier steps.
- [ ] Keep hosted and self-hosted paths parallel where their SDK/product steps
      are identical; avoid maintaining two drifting copies of the same content.

## 3. Build the Prism documentation token layer

- [ ] Create one docs stylesheet entry, preferably
      `apps/docs/src/styles/prism.css`, imported through supported Starlight
      configuration.
- [ ] Map Starlight variables to Prism semantic tokens rather than scattering
      raw hex values through component files.
- [ ] Use the exact dark tokens from `docs/design-system.md`, including:
      `canvas #050506`, `surface #0B0B0E`, `surface-raised #111116`,
      `border #25252C`, `text #F2F2F4`, `text-muted #A3A3AD`,
      `accent #6547E8`, and `focus #9B89FF`.
- [ ] Add the complete documented light-theme translation. Do not allow a
      partially restyled light mode with stock Starlight blues or grays.
- [ ] Reuse the web app's Geist and Geist Mono files through a canonical shared
      package or deterministic copy step. Do not import Google Fonts or another
      public font CDN.
- [ ] Define docs-specific typography tokens for display, article title,
      heading levels, body, caption, eyebrow, inline code, code block, and
      tabular metadata.
- [ ] Keep article prose between roughly `66ch` and `74ch`; tables, diagrams,
      and code may deliberately break to a wider content lane.
- [ ] Use a 4px-based spacing rhythm and the Prism 2px radius. Reserve full
      pills only for an explicitly justified global public CTA.
- [ ] Create a crisp two-layer keyboard focus treatment that remains visible on
      canvas, surface, violet, warning, and code backgrounds.
- [ ] Extend the token contrast gate to cover docs prose, sidebar text, links,
      active navigation, code, callouts, search, and both themes.

## 4. Redesign the global documentation shell

- [ ] Add the 2px violet viewport rail used by Prism's public experience.
- [ ] Replace the stock header presentation with a compact framed header that
      contains:
      - the Task 7 Prism mark/lockup;
      - visible `Docs` identity;
      - primary search trigger;
      - GitHub/source link;
      - theme control;
      - one contextual product action such as `Open dashboard`.
- [ ] Keep the mark square and preserve configured docs/product identity; do
      not stretch the logo or use the generated PNG as the production header.
- [ ] Use a bounded content rail with hairline vertical edges on wide screens,
      while avoiding a cramped article column on laptop widths.
- [ ] Redesign the left sidebar as a dense navigation instrument:
      mono group labels, clear selected rule/accent, compact nested items,
      visible focus, and stable indentation.
- [ ] Redesign the right table of contents with a quiet active-section marker,
      heading hierarchy, and no detached floating-card treatment.
- [ ] Give search a Prism-styled command surface with keyboard hints, grouped
      results, highlighted matching text, empty state, and accessible result
      announcements.
- [ ] Ensure the mobile header, search, navigation drawer, and on-page table of
      contents work from 320px without clipping, hidden controls, or nested
      scroll traps.
- [ ] Make desktop sidebar and table-of-contents stickiness account for the
      header height and avoid obscuring anchored headings.
- [ ] Replace the generic footer with a compact framed Prism footer linking to
      docs home, GitHub, security, hosted product, self-hosting, and license.
- [ ] Create a branded docs 404 page with search, Start Here, and
      troubleshooting links instead of a dead end.

## 5. Rebuild the documentation homepage

- [ ] Replace Starlight's stock splash template with a custom MDX/Astro landing
      page that shares Prism's public rail without duplicating the web app.
- [ ] Use a concise left-led hero:
      - `// PRISM DOCS` eyebrow;
      - concrete statement of what developers can accomplish;
      - one primary `Start with hosted Prism` action;
      - one equal, clearly visible `Self-host Prism` path;
      - search available within the first viewport.
- [ ] Add a real quickstart command frame showing the current installation,
      `PrismClient` initialization, and first event call. All examples must be
      copied from verified source behavior.
- [ ] Add a framed `Choose your path` split comparing hosted and self-hosted
      ownership without marketing distortion or invented limitations.
- [ ] Add a compact architecture strip for dashboard, product API, analytics
      ingestion, PostgreSQL, optional analytics store, and SDK. The diagram must
      distinguish required and optional services.
- [ ] Add high-signal entry panels for SDK, API reference, self-host operations,
      authentication, and troubleshooting using shared borders rather than
      floating generic cards.
- [ ] Use no invented usage statistics, customer counts, logos, or testimonials.
- [ ] Keep homepage artwork functional. Prefer code, architecture, or an actual
      product capture over abstract decorative illustration.
- [ ] Ensure the homepage remains useful with JavaScript disabled except for
      enhancements such as copy feedback and search.

## 6. Create a focused docs component system

- [ ] Create small MDX/Astro components rather than styling arbitrary prose for
      repeated product patterns.
- [ ] Add `SectionLabel` matching Prism's `//` mono voice without forcing it on
      every heading.
- [ ] Add `CodeCopy`/`Command` rows with language or shell labels, copy feedback,
      keyboard access, overflow handling, and reduced-motion behavior.
- [ ] Add accessible framework/package-manager tabs whose content remains
      discoverable and linkable.
- [ ] Add numbered `Steps` that visually align with onboarding but remain
      semantic ordered lists.
- [ ] Add callouts for `Note`, `Tip`, `Warning`, `Danger`, `Hosted`, and
      `Self-hosted`. Use icons, labels, and text in addition to color.
- [ ] Add `ConfigTable` for environment variables with columns for requirement,
      default, mode, secret status, and restart/rebuild behavior.
- [ ] Add `Endpoint` blocks for method, path, authentication, request, response,
      errors, and rate limits without implying a generated OpenAPI portal exists
      if it does not.
- [ ] Add `ArchitectureFlow` using semantic HTML/SVG with an accessible textual
      equivalent and no rasterized tiny labels.
- [ ] Add `ChoicePanel` for hosted/self-hosted forks and ensure both paths are
      keyboard reachable and equally legible.
- [ ] Add `StatusBadge` for availability such as stable/experimental/planned;
      status must come from a documented source rather than author opinion.
- [ ] Add a consistent page metadata row for audience, deployment mode, last
      reviewed date, and source owner where appropriate.
- [ ] Keep components focused and framework-native; avoid bringing the web
      dashboard's React/shadcn runtime into static documentation without a real
      interaction requirement.

## 7. Redesign article typography and technical content

- [ ] Establish an obvious article hierarchy: eyebrow/breadcrumb, title,
      description, metadata, body, local navigation, and next steps.
- [ ] Use sans-serif for prose and mono selectively for code, section labels,
      paths, environment variables, methods, and exact values.
- [ ] Style inline code as a compact technical token without turning every
      identifier into a bright badge.
- [ ] Redesign fenced code blocks with language labels, copy control, optional
      filename, line highlighting, horizontal scrolling, and readable selection.
- [ ] Ensure code colors meet contrast requirements in both themes and do not
      depend on a large collection of decorative hues.
- [ ] Make tables responsive with meaningful headers, controlled overflow, and
      a usable mobile alternative for wide configuration/reference tables.
- [ ] Give headings reliable anchor links with focus/hover behavior and enough
      scroll margin for the fixed header.
- [ ] Distinguish external links and downloads without adding an icon after
      every normal internal link.
- [ ] Add a print stylesheet that preserves headings, URLs, code, warnings, and
      page identity while removing navigation controls.
- [ ] Keep line height and paragraph spacing comfortable for long operator
      procedures despite the overall dense visual language.

## 8. Expand and reconcile the content

- [ ] Rewrite the overview to explain Prism's product boundary, data flow, and
      current maturity without generic marketing copy.
- [ ] Split the quickstart into a short verified path and deeper concept pages;
      keep the first successful event achievable without reading architecture.
- [ ] Document `@prism/core` from exported types and implementation, including
      constructor behavior, session lifecycle, events, errors, browser unload
      behavior, and public write-key security model.
- [ ] Add `@prism/react` installation and provider/hook usage only after its
      current public API is verified from source and tests.
- [ ] Document analytics ingestion endpoints, authentication, request limits,
      validation, response envelopes, failure behavior, and CORS intent from
      source code rather than stale comments.
- [ ] Document hosted authentication flows, email verification, social-provider
      behavior, sessions, service JWTs, and account controls.
- [ ] Document the supported self-hosted first-boot route and CLI bootstrap only
      after Task 6 hardening is complete; include setup-token handling without
      printing or storing secrets in examples.
- [ ] Generate the environment reference from validated source metadata where
      practical, or add a drift test comparing documented names with example
      environment files and runtime validators.
- [ ] Add operator guides for health checks, mail, storage, reverse proxy/TLS,
      backups, restore testing, upgrades, rollback boundaries, logging, and
      network egress when Task 6 marks them supported.
- [ ] Add troubleshooting organized by observed symptom, likely cause,
      safe diagnostic command, and remediation.
- [ ] Add a security model page covering browser write keys, dashboard cookies,
      service JWTs/JWKS, CORS boundaries, rate limiting, stored data, optional
      integrations, and the responsible-disclosure path.
- [ ] Add architecture and repository-development pages for contributors,
      including the two-store boundary and runtime adapter model.
- [ ] Add a visible `planned` treatment for intentionally documented future
      work, or omit it; never write future tense as if a feature already ships.

## 9. Preserve hosted and self-hosted independence

- [ ] Make hosted and self-hosted entry paths equally discoverable from the
      homepage, global navigation, search, and Start Here section.
- [ ] Do not send self-hosted operators through hosted signup to obtain an API
      key; local project creation must be documented as the source of local keys.
- [ ] Keep all docs fonts, logos, icons, styles, diagrams, and screenshots in
      the built docs artifact. No Prism cloud asset URL is required to render.
- [ ] Avoid hardcoded production dashboard/API URLs in shared examples. Use
      placeholders that make the current instance origin explicit.
- [ ] Identify which links intentionally leave a self-hosted instance for
      GitHub, package registries, OAuth consoles, or third-party integrations.
- [ ] Ensure local/offline docs remain readable when outbound network access is
      blocked after the image is built.
- [ ] Decide whether docs ship inside the default Compose topology or as a
      separately deployable static image, and document that decision in Task 6.
- [ ] If runtime instance naming appears in docs navigation, use a safe build or
      runtime configuration surface rather than hardcoding `Prism Cloud`.

## 10. Add search, SEO, metadata, and link integrity

- [ ] Keep Starlight/Pagefind search local to the built site; verify it indexes
      custom components, headings, code-adjacent prose, and new route groups.
- [ ] Define a canonical `site` value for hosted docs so sitemap generation no
      longer warns. Allow self-hosted builds to override or omit canonical URLs
      without pointing every installation at Prism cloud.
- [ ] Add consistent title templates, descriptions, canonical URLs, Open Graph,
      Twitter metadata, theme colors, and favicons derived from Task 7 assets.
- [ ] Generate a dedicated docs social preview using the approved logo lockup;
      do not stretch the square mark or reuse an unrelated dashboard capture.
- [ ] Add robots and sitemap behavior appropriate for hosted docs and document
      how private/self-hosted instances can disable indexing.
- [ ] Add an internal link checker and fail CI for broken local links, missing
      anchors, and missing referenced assets.
- [ ] Check external links separately without making normal builds depend on
      network availability; use a scheduled job or explicit verification task.
- [ ] Preserve redirects for renamed routes and test that they resolve without
      chains or loops.
- [ ] Add useful edit/source links only if their branch and repository URLs are
      stable and do not expose private deployment information.

## 11. Accessibility and interaction requirements

- [ ] Meet WCAG 2.2 AA for text, controls, focus indicators, semantic states,
      code, active navigation, search, and both themes.
- [ ] Preserve a skip link that lands on the article's main heading.
- [ ] Keep landmark structure clear: banner, navigation, search, main, article,
      complementary table of contents, and footer.
- [ ] Ensure sidebar groups, mobile menus, tabs, disclosures, search dialogs,
      copy buttons, and theme controls have correct names and states.
- [ ] Keep a logical keyboard order across the header, sidebar, article, table
      of contents, and footer; sticky regions must not create focus traps.
- [ ] Announce copy success without moving focus or relying only on an icon.
- [ ] Preserve visible focus at 200% zoom and in high-contrast/forced-colors
      modes.
- [ ] Make diagrams and screenshots optional to comprehension by providing
      equivalent text and meaningful alt descriptions.
- [ ] Respect `prefers-reduced-motion`; no content may animate into existence.
- [ ] Verify touch targets are at least 44px where controls stand alone, even if
      their visible icon is smaller.
- [ ] Test reflow at 320 CSS pixels and 400% zoom without two-dimensional page
      scrolling, except within intentionally scrollable code/table regions.

## 12. Performance and resilience

- [ ] Keep the main documentation experience static-first. Add client-side
      JavaScript only for search, navigation, tabs, copy feedback, and other
      justified interactions.
- [ ] Set performance budgets for initial HTML, critical CSS, total JavaScript,
      fonts, homepage images, and representative article pages before adding
      custom components.
- [ ] Self-host and subset fonts while preserving the characters needed for
      code, environment variables, and documentation symbols.
- [ ] Reserve image dimensions to prevent layout shift and prefer SVG for
      diagrams/logos and optimized WebP/AVIF/PNG for screenshots.
- [ ] Lazy-load non-critical screenshots and diagrams below the fold.
- [ ] Ensure search and navigation still fail gracefully if their enhancement
      script does not load.
- [ ] Add a Content Security Policy compatible with static docs without
      `unsafe-eval`; document any temporary `unsafe-inline` requirement and a
      removal path.
- [ ] Confirm the production artifact contains no source maps or embedded
      secrets that are not intentionally public.

## 13. Implement in reviewable slices

### Slice A — inventory, IA, and foundations

- [ ] Record baselines, finalize the route map, wire Prism tokens/fonts, and add
      the Task 7 logo without changing all page content at once.
- [ ] Add redirects and link checks before moving existing routes.
- [ ] Verify dark/light tokens, contrast, build, and mobile shell.

### Slice B — global shell

- [ ] Implement header, sidebars, table of contents, search, footer, mobile
      navigation, skip link, and 404 treatment.
- [ ] Keep Starlight behavior intact through supported overrides.
- [ ] Capture desktop/mobile screenshots and run axe before continuing.

### Slice C — homepage and MDX components

- [ ] Build the new docs homepage and focused component library.
- [ ] Add component examples/tests for commands, steps, tabs, callouts,
      configuration tables, endpoint blocks, and deployment choices.
- [ ] Verify copy, keyboard, reduced-motion, and no-JavaScript behavior.

### Slice D — core user/developer content

- [ ] Rewrite Start Here, hosted quickstart, SDK, React integration, project
      keys, sessions/events, and ingestion API reference from source.
- [ ] Add drift tests for constructor signatures, package names, endpoints, and
      environment-variable names.

### Slice E — self-hosted operator content

- [ ] Add installation, first boot, configuration, storage, proxy/TLS,
      backup/restore, upgrades, health, mail, networking, and troubleshooting
      only for Task 6 capabilities that have passed certification.
- [ ] Run the documented commands against a clean supported deployment and
      capture redacted output where it materially helps.

### Slice F — final QA and release readiness

- [ ] Complete metadata, sitemap, social preview, print styles, accessibility,
      link integrity, performance budgets, browser QA, and offline/self-hosted
      artifact checks.
- [ ] Remove temporary screenshots, unused Starlight overrides, obsolete assets,
      dead routes, and placeholder copy.
- [ ] Update this checklist with exact evidence and commit each slice separately.

## 14. Testing and verification matrix

- [ ] `astro check` and production build pass from a clean checkout.
- [ ] Internal link, anchor, redirect, sitemap, and static-asset checks pass.
- [ ] Unit/component tests cover custom interactive documentation components.
- [ ] Browser tests cover homepage, article, search, mobile navigation, theme,
      code copy, tabs, 404, and hosted/self-hosted path selection.
- [ ] Axe reports no serious or critical violations on representative pages.
- [ ] Keyboard-only and screen-reader smoke tests cover the complete shell.
- [ ] Dark mode, light mode, reduced motion, forced colors, 200% zoom, 400%
      reflow, 320px mobile, tablet, laptop, and wide desktop are verified.
- [ ] Chrome, Firefox, and Safari receive visual smoke coverage where available.
- [ ] Lighthouse meets the agreed accessibility, performance, best-practice,
      and SEO budgets on the homepage and a content-heavy reference page.
- [ ] Offline production preview renders fonts, logo, styles, diagrams, search,
      and content without third-party asset requests.
- [ ] A clean self-hosted install follows the documented operator journey
      without requiring Prism cloud signup or undocumented commands.
- [ ] Repository-wide build, typecheck, lint, tests, and dependency audit pass.

## Acceptance criteria

- The site is immediately recognizable as Prism rather than stock Starlight.
- Homepage, documentation shell, search, code, calls to action, and content
  components use the same token, type, border, radius, and interaction language
  as the redesigned Prism product.
- Hosted users and self-hosted operators each have a complete, honest, visible
  path from the docs homepage to a first verified event.
- Technical claims, commands, API examples, SDK signatures, environment names,
  and deployment instructions are verified against source or a certified
  deployment.
- The Task 7 logo is consumed from the canonical asset system; no generated
  reference PNG or unrelated hand-edited copy becomes the production source.
- Dark and light modes are complete, accessible, responsive, and free of stock
  theme-color leakage.
- All assets are local to the built distribution, and the site remains useful
  with outbound access blocked.
- The design remains dense and technical without sacrificing prose readability,
  keyboard use, mobile navigation, or long-session comfort.
- The docs build has no missing-site/sitemap warning, broken internal links,
  missing assets, or serious accessibility violations.

## Deliverables

- Redesigned Prism documentation homepage.
- Redesigned Starlight-based header, sidebar, search, table of contents, footer,
  mobile navigation, article layout, and 404 page.
- Shared Prism docs token/font layer for dark and light themes.
- Focused MDX/Astro component library for commands, steps, tabs, callouts,
  configuration, endpoints, architecture, status, and deployment choices.
- Expanded Start Here, hosted, self-hosted, SDK, API, product, operations,
  security, troubleshooting, and contributing content.
- Redirect map, link/anchor checker, drift checks, metadata, sitemap, robots,
  favicon, and social-preview integration.
- Accessibility, browser, responsive, performance, offline, and self-hosted
  verification evidence.
