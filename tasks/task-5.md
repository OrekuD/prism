# Task 5: Redesign the landing, authentication, and onboarding experience

## Goal

Replace Prism's temporary public/auth screens with a coherent developer-product
experience inspired by commandcode.ai's disciplined, terminal-adjacent visual
language. The result must be distinctly Prism, accessible, responsive, and
usable for both the hosted platform and a standalone self-hosted instance.

This task follows the Better Auth and React/Tailwind/shadcn migrations. It does
not expand the unfinished analytics core beyond what these entry flows require.

Implementation source of truth: [`docs/design-system.md`](../docs/design-system.md).
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
- [ ] Preserve existing analytics event names where useful; define intentional
      new events for signup method, onboarding progress, docs clicks, and first
      event success without collecting sensitive form content.

## 2. Build the public landing page

- [x] Replace the two-button index placeholder with a real public page.
- [x] Use a left-aligned or asymmetric hero that fits in the initial viewport.
      Keep the value proposition concrete and the hosted signup CTA visible.
- [x] Provide a separate, non-competing self-host link such as "Self-host Prism"
      that leads to deployment documentation rather than a cloud registration wall.
- [x] Show the actual setup journey: install SDK, initialize with a project key,
      send an event, and see the session in realtime. Real SDK rows
      (yarn add @prism/core, new PrismClient with redacted key, logEvent)
      with copy controls; JavaScript/React tabs.
- [ ] Use a real Prism dashboard capture or functioning embedded preview after
      the dashboard styling is stable. Do not manufacture a fake product UI.
      Hero panel currently shows the live setup rows; the dashboard capture
      slot swaps in during the dashboard-alignment slice.
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
- [ ] Provide explicit pending, success, invalid-link, expired-link,
      provider-denied, account-not-linked, and offline states. Pending/success/
      invalid+expired-link states live; provider-denied, account-not-linked,
      and offline states remain with the edge-screen slice.
- [ ] Keep callback pages stable during redirects and prevent duplicate form
      submissions.
- [x] Make self-hosted instance identity visible in the auth shell so users know
      which deployment they are signing into. Instance host from the API base
      URL, desktop context panel + mobile identity line.
- [ ] Test narrow mobile screens, keyboard-only use, zoom to 200%, dark/light
      modes, reduced motion, and password-manager autofill. Narrow mobile
      verified; the full matrix runs in the QA slice.

## 4. Add first-run onboarding

Hosted flow:

- [ ] After authentication, collect only missing profile information.
- [ ] Create or confirm the personal team/workspace.
- [ ] Create the first project and issue its analytics write key.
- [ ] Show framework-neutral and React-specific SDK installation snippets with
      copy actions and redacted/example keys.
- [ ] Wait for and visibly confirm the first real session/event rather than
      claiming setup succeeded before ingestion is observed.
- [ ] Provide a clear skip/resume path and persist onboarding progress.

Self-hosted flow:

- [ ] On first boot, guide the operator through local owner creation rather
      than Prism cloud signup.
- [ ] Confirm instance name, public URL, signup policy, optional email provider,
      and optional GitHub/Google credentials.
- [ ] Create the first local project/key and run the same SDK verification flow.
- [ ] Show deployment health and missing optional integrations without blocking
      basic local analytics.
- [ ] Ensure no onboarding action contacts Prism cloud unless the operator has
      explicitly enabled a future opt-in integration.

## 5. Refresh temporary and edge screens

- [ ] Create a branded not-found page for public and authenticated contexts.
- [ ] Create maintenance/unavailable and API-connectivity error states.
- [ ] Create empty states for no teams, no projects, no sessions, no events, and
      unavailable Mapbox, each with one appropriate next action.
- [ ] Create invitation accepted, invitation invalid/expired, and access-denied
      states.
- [ ] Add skeletons that match final layouts rather than centered spinners.
- [ ] Standardize toast usage for transient confirmation only; keep actionable
      errors inline or in contextual alerts.

## 6. Ensure the dashboard inherits the visual language

- [ ] Apply the new tokens to navigation, project summaries, event lists,
      realtime panels, API keys, and settings without rebuilding unfinished core
      features in this task.
- [ ] Use the commandcode.ai screenshot's compact label/data hierarchy as a
      reference for usage metrics and quick-start panels, while designing an
      original Prism layout.
- [ ] Present API keys and SDK instructions as first-class developer workflows,
      including copy feedback and safe redaction.
- [ ] Avoid generic card grids where separators, aligned metrics, or grouped
      sections communicate hierarchy more directly.
- [ ] Keep actual live-status accents semantic and sparse.

## 7. Visual, accessibility, and performance QA

- [ ] Add route-level visual regression coverage for every new state at desktop,
      tablet, and mobile widths.
- [ ] Test light and dark modes, with dark as the primary brand presentation.
- [ ] Run automated and manual keyboard/screen-reader accessibility checks.
- [ ] Verify WCAG AA contrast for body text, controls, placeholders, errors,
      focus indicators, code blocks, and chart legends.
- [ ] Honor reduced motion and avoid scroll listeners that update React state.
- [ ] Keep LCP below 2.5s, CLS below 0.1, and INP below 200ms on representative
      production builds.
- [ ] Self-host fonts and optimize screenshots/assets with explicit dimensions.
- [ ] Re-read all public copy for concrete claims, consistent terminology, and
      no unsupported metrics or placeholder language.

## Status

In progress on `task-5-hosted-experience`. Slices A (spec tokens, Geist,
radius, contrast gate), B (landing page + public layout + SEO), and C
(shared auth shell + four auth flows) are committed. Remaining: hosted
onboarding, empty/error screens, dashboard visual alignment, then the
Task 6 foundation (deployment-mode config, first-owner bootstrap, signup
policy) before the self-hosted onboarding portion, and finally the
a11y/visual-regression QA slice.

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
