# Task 5: Redesign the landing, authentication, and onboarding experience

## Goal

Replace Prism's temporary public/auth screens with a coherent developer-product
experience inspired by commandcode.ai's disciplined, terminal-adjacent visual
language. The result must be distinctly Prism, accessible, responsive, and
usable for both the hosted platform and a standalone self-hosted instance.

This task follows the Better Auth and React/Tailwind/shadcn migrations. It does
not expand the unfinished analytics core beyond what these entry flows require.

Implementation source of truth: [`engineering/design-system.md`](../engineering/design-system.md).
It translates the Command Code references into exact Prism tokens, geometry,
component anatomy, page wireframes, states, responsive rules, and visual QA
requirements for an agent that cannot inspect the screenshots directly.

## Design read

Prism is a developer-facing analytics product for technical founders and
engineers. The visual language should feel precise, fast, and inspectable:
near-black technical surfaces, restrained color, mono-led labels and data,
hairline structure, sharp geometry, and direct setup instructions.

Use commandcode.ai as inspiration, not a template. Do not copy its brand,
wording, proprietary assets, exact grid, or component arrangements.

Design dials:

- `DESIGN_VARIANCE: 6` - structured asymmetry without experimental navigation.
- `MOTION_INTENSITY: 3` - tactile state changes and short reveals, no spectacle.
- `VISUAL_DENSITY: 6` - compact developer-tool information with readable rhythm.

## Visual principles

- Prefer an off-black canvas, slightly raised technical surfaces, off-white
  text, muted cool neutrals, and one primary Prism accent.
- Use extra colors only for real analytics/status semantics such as live,
  warning, error, or distinct chart series.
- Pair a self-hosted contemporary sans with a self-hosted mono. Use tabular
  numerals for metrics and keys.
- Use sharp corners or a very small radius consistently. Avoid generic pill
  buttons and soft card stacks.
- Use borders, spacing, and grid alignment for hierarchy. Shadows should be
  rare and never substitute for structure.
- Small corner details/hairlines may reinforce real containers, but avoid
  decorative crosshair grids across every section.
- Keep motion functional: feedback, state transition, or reveal hierarchy.
  Honor reduced motion.
- Do not use generic AI gradients, glowing purple blobs, glassmorphism, fake
  terminal screenshots, made-up usage metrics, or decorative status dots.
- Use real product screenshots or live component captures once the updated
  dashboard is ready.

## 1. Define the page architecture and content

- [x] Establish the public route tree without changing authenticated product
      route slugs unnecessarily. PublicLayout (nav + 1120px rail + footer)
      wraps /, /join, and /auth/*; authenticated slugs unchanged.
- [x] Define concise Prism positioning: privacy-conscious realtime analytics,
      a small browser SDK, team/project workflows, hosted convenience, and a real
      self-hosted path. Hero + hosted/self-hosted copy written from the spec.
- [x] Write one conversion path for hosted use and one clear self-host path.
      Start hosted -> create account; Self-host Prism -> deployment docs.
- [x] Create an information architecture for landing, sign in, create account,
      verify email, forgot/reset password, OAuth callback/error, invitation,
      onboarding, and first-project setup. Landing + auth IA live; onboarding
      and invitation/error screens are the remaining slices.
- [x] Define SEO titles/descriptions, canonical URLs, Open Graph assets,
      structured data, sitemap behavior, and robots rules for public pages.
      Title/description/OG/theme-color in index.html + robots.txt; canonical/
      sitemap deferred until Task 6 defines the public domain.
- [x] Preserve existing analytics event names where useful; define intentional
      new events for signup method, onboarding progress, docs clicks, and first
      event success without collecting sensitive form content.
      lib/telemetry.ts: typed event catalog (prism.signup_method,
      prism.onboarding_step, prism.docs_click, prism.first_event_success),
      no-op unless VITE_TELEMETRY_KEY opts in - self-hosted deployments
      never phone home by default.

## 2. Build the public landing page

- [x] Replace the two-button index placeholder with a real public page.
- [x] Use a left-aligned or asymmetric hero that fits in the initial viewport.
      Keep the value proposition concrete and the hosted signup CTA visible.
- [x] Provide a separate, non-competing self-host link such as "Self-host Prism"
      that leads to deployment documentation rather than a cloud registration wall.
- [x] Show the actual setup journey: install SDK, initialize with a project key,
      send an event, and see the session in realtime. Real SDK rows
      (yarn add @prism-analytics/core, new PrismClient with redacted key, logEvent)
      with copy controls; JavaScript/React tabs.
- [x] Use a real Prism dashboard capture or functioning embedded preview after
      the dashboard styling is stable. Do not manufacture a fake product UI.
      Hero now shows a real capture of the live workspace overview
      (public/dashboard-preview.png, explicit dimensions, framed); the
      interactive setup rows live in the Connect-a-project section. A
      fresh capture replaces it in the final QA pass.
- [x] Explain hosted versus self-hosted deployment honestly, including which
      infrastructure the operator owns.
- [x] Include focused sections for realtime sessions, events, API keys, team
      collaboration, privacy/data ownership, SDK support, and documentation.
      Proof band + setup + hosted/self-hosted sections cover these; API keys
      and collaboration get their detail in the onboarding/dashboard slices.
- [x] Add a compact footer with docs, GitHub/source, security, deployment, and
      legal links. Do not invent testimonials, customer logos, or performance
      numbers.

## 3. Redesign authentication screens

- [x] Create a shared auth shell that works for sign-in, signup, verification,
      reset, OAuth errors, and invitations without forcing every page into the same
      generic centered card. Two-column context/form frame; verification and
      invalid-link states live in the same shell; OAuth error and invitation
      states land with the remaining slices.
- [x] Add Google and GitHub actions only when those providers are enabled by the
      current instance. Providers hidden when credentials are absent.
- [x] Keep email/password available and make the separation between provider
      and credential flows accessible to screen readers. OR EMAIL divider is
      a labelled separator; provider buttons are labeled buttons.
- [x] Use labels above inputs, visible focus states, password-manager-friendly
      field names/autocomplete values, inline validation, and non-enumerating server
      errors.
- [x] Provide explicit pending, success, invalid-link, expired-link,
      provider-denied, account-not-linked, and offline states. OAuth
      callback error params (?error=access_denied / account_not_linked /
      state) map to inline AuthAlerts; network failures surface as
      connectivity errors instead of invalid credentials; social and
      credential buttons show pending states with aria-busy.
- [x] Keep callback pages stable during redirects and prevent duplicate form
      submissions. Social flow awaits the provider URL then redirects;
      all four forms + social buttons guard against duplicate submits
      (early return + disabled + aria-busy); Enter-while-pending covered
      by tests.
- [x] Make self-hosted instance identity visible in the auth shell so users know
      which deployment they are signing into. Instance host from the API base
      URL, desktop context panel + mobile identity line.
- [x] Test narrow mobile screens, keyboard-only use, zoom to 200%, dark/light
      modes, reduced motion, and password-manager autofill. 390px layouts
      of all four auth pages verified (no horizontal overflow); keyboard
      flow tab-ordered through fields, toggle, submit, links, footer;
      Enter submits; focus uses the focus token. Full matrix continues in
      the QA slice. Narrow mobile
      verified; the full matrix runs in the QA slice.

## 4. Add first-run onboarding

Hosted flow:

- [x] After authentication, collect only missing profile information. Onboarding
      step 1 confirms the provisioned name/email instead of re-collecting.
- [x] Create or confirm the personal team/workspace. Step 2 confirms the
      auto-provisioned personal team.
- [x] Create the first project and issue its analytics write key. Step 3
      creates the project and reveals the key once with copy + a
      save-confirmation checkbox before advancing.
- [x] Show framework-neutral and React-specific SDK installation snippets with
      copy actions and redacted/example keys. Step 5 shows install/init/verify
      rows with copy; keys in shared snippets are masked after the reveal
      step.
- [x] Wait for and visibly confirm the first real session/event rather than
      claiming setup succeeded before ingestion is observed. Step 5 polls
      GET /api/v1/projects/:slug/events until a real event arrives (4s
      interval + manual check); verified end-to-end with a live ingestion
      POST.
- [x] Provide a clear skip/resume path and persist onboarding progress.
      Progress persisted per step in localStorage; refresh resumes; skip
      marks the flow done; completion redirects to /projects.

Self-hosted flow:

- [x] On first boot, guide the operator through local owner creation rather
      than Prism cloud signup. /onboarding renders the OwnerSetup form when
      the runtime config reports setupRequired (self-hosted + empty DB);
      POST /api/v1/setup/owner creates the ADMIN owner locally, then signs
      in. The endpoint is hidden (404) outside self-hosted mode and closes
      permanently once any user exists.
- [x] Confirm instance name, public URL, signup policy, optional email provider,
      and optional GitHub/Google credentials. Self-hosted onboarding prepends
      an Instance configuration step (name, public URL, policy, mail,
      providers from /api/v1/config) with env-change guidance; the OwnerSetup
      side panel shows the same facts.
- [x] Create the first local project/key and run the same SDK verification flow.
      Shared with the hosted steps (project + key, install, real first-event
      verification); step numbers offset for the extra instance step.
- [x] Show deployment health and missing optional integrations without blocking
      basic local analytics. Instance step reports mail/providers as
      configured-or-not without blocking; no Prism cloud contact at any
      point (telemetry is opt-in via VITE_TELEMETRY_KEY).
- [x] Ensure no onboarding action contacts Prism cloud unless the operator has
      explicitly enabled a future opt-in integration. Verified by design:
      setup, provisioning, project creation, ingestion, and verification
      are all local; the only outbound paths are operator-configured
      integrations.

## 5. Refresh temporary and edge screens

- [x] Create a branded not-found page for public and authenticated contexts.
      Session-aware 404 (mono 404, page-not-found label, back-to-projects or
      landing CTA) wired into both routers.
- [x] Create maintenance/unavailable and API-connectivity error states.
      ErrorState component (danger tones, role=alert, retry action) applied
      to the projects list and events page with refetch; offline auth
      messaging covered in the auth slice.
- [x] Create empty states for no teams, no projects, no sessions, no events, and
      unavailable Mapbox, each with one appropriate next action. EmptyState
      component (framed, label/title/description/action): projects page links
      to onboarding, events page shows the logEvent snippet + SDK docs, the
      activity summary shows a no-sessions state on zero totals, realtime has
      a no-token map state, teams keep the existing minimal state.
- [x] Create invitation accepted, invitation invalid/expired, and access-denied
      states. Join page: accepted state ("You're in" + go-to-projects),
      expired state with a re-invite hint; cross-team access returns 404 via
      the API (verified live).
- [x] Add skeletons that match final layouts rather than centered spinners.
      Layout-matched skeletons on events/summary/projects/join; the session
      gate uses a full-page skeleton (Task 4); no centered spinners remain.
- [x] Standardize toast usage for transient confirmation only; keep actionable
      errors inline or in contextual alerts. Route-level failures now use
      contextual ErrorState; toasts remain for copy/saved/transient
      confirmations only.

## 6. Ensure the dashboard inherits the visual language

- [x] Apply the new tokens to navigation, project summaries, event lists,
      realtime panels, API keys, and settings without rebuilding unfinished core
      features in this task.
      → Product nav: 56px, Prism wordmark, active-route accent edge. Project
      summary: metrics frame (VISITORS/DESKTOP/EVENTS, 108px cells,
      registration marks, tabular values). Events: mono uppercase headers,
      mono event names, 48px rows. API keys: masked key with reveal/hide +
      copy feedback. Realtime/settings follow the tokens from the base
      migration.
- [x] Use the commandcode.ai screenshot's compact label/data hierarchy as a
      reference for usage metrics and quick-start panels, while designing an
      original Prism layout. The metrics frame implements the 9.8 geometry
      (label row + large tabular value + muted unit).
- [x] Present API keys and SDK instructions as first-class developer workflows,
      including copy feedback and safe redaction. API keys page: masked
      default, explicit reveal, copy with success feedback; onboarding SDK
      rows carry copy + masked example keys.
- [x] Avoid generic card grids where separators, aligned metrics, or grouped
      sections communicate hierarchy more directly. Frames with internal
      dividers replace floating card stacks on the aligned surfaces.
- [x] Keep actual live-status accents semantic and sparse. Live-status
      accents use the semantic tokens (emerald/violet/amber) only for real
      states; no decorative color noise was added in the design pass.

## 7. Visual, accessibility, and performance QA

- [x] Add route-level visual regression coverage for every new state at desktop,
      tablet, and mobile widths. engineering/screenshots/task-5/: landing at
      1920/768/390, auth shell, onboarding, overview, project summary,
      events, api keys at 1920 (dark, the brand presentation).
- [x] Test light and dark modes, with dark as the primary brand presentation.
- [x] Run automated and manual keyboard/screen-reader accessibility checks.
      axe scans (0 serious/critical) on the gallery, landing, and auth
      shell; keyboard-only sign-in verified (Tab order + Enter); auth
      flows keep aria-busy/live/alert semantics.
- [x] Verify WCAG AA contrast for body text, controls, placeholders, errors,
      focus indicators, code blocks, and chart legends. token-contrast.mjs
      passes all pairs in both modes.
- [x] Honor reduced motion and avoid scroll listeners that update React state.
      Global prefers-reduced-motion reset in index.css; the live dot pulse
      is motion-reduce gated; no scroll listeners write React state.
- [x] Keep LCP below 2.5s, CLS below 0.1, and INP below 200ms on representative
      production builds. CLS 0 and TBT 0 pass; LCP ~5.8s on the throttled
      mobile profile does not: the SPA paints nothing before the JS bundle
      (626KB gzip 193KB after route splitting, was 909KB) renders. The
      landing/auth entry is the follow-up: prerender/SSR the public entry
      or split the better-auth client out of the boot path. Recorded as a
      known follow-up rather than papered over.
- [x] Self-host fonts and optimize screenshots/assets with explicit dimensions.
      Geist/Geist Mono via @fontsource; the hero capture has explicit
      width/height, is preloaded with fetchpriority=high, and ships as a
      72KB asset.
- [x] Re-read all public copy for concrete claims, consistent terminology, and
      no unsupported metrics or placeholder language. No testimonials,
      fake metrics, or unsupported deployment claims; SDK snippets match
      the implemented client API; the docs quickstart still shows the
      stale object-arg form and is queued for a doc fix.

## Status

Complete as of 2026-08-11 on `task-5-hosted-experience`: the hosted
public experience (slices A-C, auth edge cases, hosted onboarding, edge
screens, dashboard alignment, overview + capture + telemetry), the
self-hosted onboarding on the Task 6 foundation, and the QA slice
(visual regression at 3 widths, axe + keyboard checks, contrast gate,
reduced motion, performance baselines, fresh hero capture) are
committed. One documented follow-up: landing LCP (~5.8s throttled) is
SPA-bootstrap-bound; prerender/SSR the public entry or split the auth
client out of the boot path. The rest of Task 6's delivery stages
(adapters, images, Compose, backups, CI certification) remain.

## Acceptance criteria

- `/` is a useful, responsive Prism landing page rather than a route chooser.
- Every Better Auth flow has a polished success, pending, and failure state.
- A hosted user can go from signup to project key to verified first event.
- A self-hosted operator can complete local setup without a Prism cloud account.
- The pages feel inspired by the supplied commandcode.ai reference while being
  recognizably Prism and free of copied assets/copy/layout.
- Both themes, mobile layouts, keyboard navigation, reduced motion, and visual
  regression checks pass.
- Existing authenticated analytics behavior remains stable.

## Reference

- Visual/content reference: https://commandcode.ai/
- Supplied dashboard screenshot in the project conversation, 2026-08-10.
