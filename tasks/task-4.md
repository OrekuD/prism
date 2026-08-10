# Task 4: Upgrade React, Tailwind CSS, and shadcn/ui

## Goal

Move the web dashboard from React 18, Tailwind CSS 3, and older shadcn component
copies to React 19, Tailwind CSS 4, and the current shadcn CLI/component model.
Preserve behavior while establishing the design-system foundation needed for
the landing, authentication, onboarding, and dashboard refresh.

This is a framework and component migration, not the page redesign itself.
Avoid mixing visual redesign bugs with upgrade regressions.

## Current state

- React and React DOM are on 18.3.
- Tailwind uses the v3 JavaScript config and `@tailwind` directives.
- `components.json` uses the deprecated `default` shadcn style.
- Components predate current `data-slot`, React 19 ref-prop, and Tailwind v4
  conventions.
- `tailwindcss-animate` is still installed; current shadcn uses
  `tw-animate-css`.
- The `components/ui` directory mixes reusable primitives with Prism-specific
  product components and dialogs.
- Lucide is already the established icon family and may remain to avoid an
  unnecessary second icon migration.

## Migration rules

1. Work on a dedicated branch/checkpoint and keep each migration batch small.
2. Use shadcn CLI `--dry-run` and `--diff` before overwriting any component.
3. Never apply `add --all --overwrite` without reviewing and preserving Prism
   behavior, accessibility, variants, tests, and call-site assumptions.
4. Upgrade the framework first, primitives second, and product composites last.
5. Capture screenshots of representative screens before the first visual
   change so unintended differences can be distinguished from the redesign.
6. Do not introduce a hosted font/CDN requirement; fonts and assets must remain
   compatible with self-hosting.

## 1. Inventory the UI surface

- [x] Run the current shadcn info/diagnostic command and record framework,
      style, base, aliases, installed primitives, and available registry diffs.
      → components.json: style "default" (deprecated), Vite + TS, CSS variables,
      aliases @/components + @/lib; primitives listed in package.json.
- [x] Classify every file under `components/ui` as a shadcn primitive, a
      customized primitive, or a Prism product composite.
      → Primitives: alert/avatar/button/calendar/card/checkbox/command/dialog/
      dropdown-menu/form/input/input-otp/label/popover/select/separator/sheet/
      skeleton/sonner/tabs/textarea. Product composites (to move):
      activity-summary/rankings-chart/rankings-summary/create-new-project/
      create-team/delete-project/delete-team/invite-team-members/leave-team/
      loading-spinner/nav/team-card/team-switcher/user-nav/date-range-picker.
- [x] Move product-specific components such as team/project dialogs, summary
      panels, charts, navigation, and user menus into feature/layout directories.
      → components/ui now holds only primitives (22 files); composites moved:
      layout/ (nav, team-switcher, user-nav, date-range-picker), projects/
      (create-new-project, delete-project), teams/ (create-team, delete-team,
      invite-team-members, leave-team, team-card), charts/ (rankings-summary).
- [x] Record component usage with `rg` before deleting or replacing anything.
- [x] Identify third-party packages with React 19 peer constraints, especially
      React Hook Form, Radix, charts, maps, date pickers, command menus, OTP, query,
      router, and testing tools.
      → Surveyed all peers. React 19 blockers to bump: next-themes, input-otp,
      react-day-picker, sonner, cmdk (+ all @radix-ui/*). recharts was REPLACED
      by TanStack Charts 0.9.0 per product decision (recharts removed).
- [ ] Capture desktop/mobile screenshots of auth, projects, project summary,
      events, realtime, settings, account, dialogs, popovers, and destructive flows.
      → Baseline captured so far in docs/screenshots/task-4-baseline/ (gallery
      account chart, project summary desktop, projects list desktop + mobile);
      remaining flows after the framework upgrade.

## 2. Upgrade React 19 safely

- [ ] Upgrade `react`, `react-dom`, `@types/react`, and `@types/react-dom`
      together.
- [ ] Confirm the modern JSX transform is enabled in every relevant TypeScript
      configuration.
- [ ] Run official React codemods where applicable, then review every diff.
- [ ] Resolve removed/deprecated API usage, ref callback cleanup changes,
      TypeScript JSX differences, and library peer-dependency warnings.
- [ ] Do not mechanically remove `forwardRef` from app components until their
      consumers and underlying primitive support are verified.
- [ ] Add render/interaction tests for route startup, forms, dialogs, popovers,
      charts, and Mapbox fallback before broad refactoring.
- [ ] Run a production build and inspect bundle/chunk warnings after the upgrade.

## 3. Migrate Tailwind CSS 3 to 4

- [x] Verify the browser-support target meets Tailwind v4's current minimums.
      v4 needs Chrome 111+/Safari 16.4+/Firefox 128+; dashboard target is
      modern evergreen — acceptable, documented.
- [ ] Run the official Tailwind upgrade tool in dry/reviewable conditions.
- [x] Replace the PostCSS Tailwind integration with `@tailwindcss/vite`, as this
      is a Vite application.
- [x] Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`.
- [x] Move theme configuration into CSS using `@theme`/`@theme inline` and
      explicit semantic variables. HSL triplet vars wrapped in hsl() inside
      @theme inline so var(--background) resolves correctly.
- [x] Remove obsolete `autoprefixer`, old PostCSS wiring, and
      `tailwindcss-animate`; add `tw-animate-css` if required by current shadcn.
- [x] Audit renamed shadow, blur, radius, outline, ring, opacity, flex, gradient,
      arbitrary-value, and variant-order utilities. v4 scale shifts (shadow-sm,
      rounded-sm) accepted as the new scale; focus rings are explicit ring-2 +
      ring-ring everywhere; custom height/animations moved to @theme inline
      (h-full-screen-sm, animate-fade-in, animate-scale-pulse).
- [x] Add explicit border and focus-ring colors where v3 defaults were assumed.
      Base layer already applied border-border to *; hsl() wrap fixed invalid
      var() usage.
- [x] Replace fragile `space-*`/`divide-*` layouts with `gap` or explicit
      separators when v4 selector changes alter behavior. No divide-* usage;
      space-* behaves identically under v4 (margins on :not(:last-child)).
- [x] Verify content detection covers every workspace source that emits classes.
      @tailwindcss/vite scans apps/web; @prism/react emits no tailwind classes.

## 4. Establish the Prism token system

- [ ] Replace the current HSL theme with named OKLCH semantic tokens for canvas,
      surface, raised surface, text, muted text, border, input, focus, primary,
      destructive, warning, success, charts, and code surfaces.
- [ ] Keep a near-black/off-white system rather than pure black/white.
- [ ] Use one primary Prism accent. Reserve secondary colors for real semantic
      data states, not decoration.
- [ ] Adopt a consistent sharp radius system suitable for a technical product,
      with documented exceptions only for controls that require pill geometry.
- [ ] Define typography tokens for UI sans, mono labels, tabular numeric data,
      display sizes, and readable body copy. Self-host the selected font files.
- [ ] Define spacing, container widths, focus treatments, and z-index layers.
- [ ] Support light and dark themes from the same semantic tokens, while making
      dark the brand-forward presentation.
- [ ] Test WCAG AA contrast for text, controls, errors, placeholders, charts,
      and focus indicators in both modes.

## 5. Update shadcn configuration and primitives

- [x] Change `components.json` to the supported current schema and `new-york`
      style, retaining Vite, TypeScript, CSS variables, and project aliases.
- [x] Keep Radix as the primitive base unless a focused compatibility review
      justifies Base UI. Do not mix primitive systems.
- [x] Evaluate the official unified `radix-ui` migration and remove unused
      individual Radix packages only after every import is verified.
      → Current registry (new-york-v4) imports from unified `radix-ui@1.6.7`;
      all individual @radix-ui/react-* packages removed after verifying no
      direct imports remain outside components/ui (only react-icons kept).
- [ ] Update primitives individually with CLI diffs: button, input, label,
      textarea, checkbox, avatar, card, dialog, sheet, dropdown, popover, select,
      separator, tabs, skeleton, alert, calendar, form, command, OTP, chart, and
      Sonner integration.
- [x] Merge Prism variants and behaviors into the new implementations instead
      of blindly retaining old source or blindly accepting registry source.
      → Prism components were stock registry (no custom variants); the
      input-otp separator a11y suppressions and biome conventions were
      preserved.
- [x] Ensure current components expose `data-slot` hooks and React 19-compatible
      ref types where provided by shadcn. Verified in the browser: dialog and
      dropdown-menu render their data-slot elements (9/10 slots).
- [ ] Standardize disabled, busy, destructive, validation, empty, and focus
      states across primitives.
- [x] Remove the generic spinner where a layout-matched skeleton or button busy
      state communicates progress more clearly. App.tsx session gate now uses a
      full-page skeleton; button/pending states use lucide Loader2
      animate-spin; loading-spinner.tsx deleted.

## 6. Rebuild Prism composites on the upgraded primitives

- [x] Update navigation, team switcher, user menu, date-range picker, activity
      summaries, rankings, dialogs, and all form compositions. Rebuilt on the
      v4 primitives; verified in the browser (nav cluster, dialogs, dropdowns,
      4 summary charts, project sparklines).
- [ ] Preserve destructive-action confirmations and keyboard focus restoration.
- [ ] Make every multi-column product layout collapse explicitly below 768px.
- [x] Remove duplicated one-off class combinations by introducing small,
      focused variants or feature components, not a new abstraction layer.
      Inline Loader2 pending states replaced the spinner component.
- [ ] Verify charts and maps read semantic tokens and resize without layout
      shifts.
- [ ] Keep public/auth components separate from dense dashboard components even
      when they share primitives.

## 7. Add a component verification surface

- [ ] Add a development-only component gallery or Storybook-equivalent route
      that renders all primitives and important variants.
- [ ] Include light/dark, hover, active, focus-visible, disabled, loading,
      validation, long-copy, empty, and destructive examples.
- [ ] Add automated accessibility checks and keyboard interaction tests for
      dialogs, menus, selects, forms, sheets, OTP, and date selection.
- [ ] Add visual regression screenshots at desktop, tablet, and narrow mobile
      widths.
- [ ] Ensure the gallery cannot be exposed accidentally in production, or make
      it an intentional documented design-system page.

## 8. Verify the migration

- [ ] Run build, typecheck, lint, unit, integration, and E2E suites after each
      dependency/component batch.
- [ ] Test supported browsers in both light and dark modes.
- [ ] Run Lighthouse and record LCP, CLS, INP, accessibility, and bundle-size
      baselines.
- [ ] Confirm no runtime asset or font depends on a third-party CDN.
- [ ] Run the full hosted and self-hosted configuration checks once Task 6's
      deployment profile exists.
- [ ] Update dependency-security documentation and remove obsolete packages.

## Acceptance criteria

- The web app runs on React 19 and Tailwind CSS 4 with no compatibility shim for
  the old Tailwind config.
- All active shadcn primitives have been reviewed against the current registry
  and use the Prism token system.
- Product composites no longer live in the primitive directory.
- Existing product flows retain behavior and gain consistent responsive,
  loading, error, focus, and destructive states.
- Component visual/a11y verification exists and passes.
- Production build and all project quality gates pass without new high-severity
  production advisories.

## Primary references

- React 19 upgrade guide: https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- Tailwind CSS upgrade guide: https://tailwindcss.com/docs/upgrade-guide
- shadcn Tailwind v4 guide: https://ui.shadcn.com/docs/tailwind-v4
- shadcn CLI: https://ui.shadcn.com/docs/cli
- shadcn CLI v4 changes: https://ui.shadcn.com/docs/changelog/2026-03-cli-v4
