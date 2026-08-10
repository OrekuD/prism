# Prism Product Design Specification

**Status:** Proposed implementation specification  
**Audience:** Coding agents, frontend engineers, reviewers, and future designers  
**Primary references:** User-supplied Command Code workspace and pricing screenshots, plus https://commandcode.ai/  
**Related work:** `tasks/task-4.md`, `tasks/task-5.md`, and `tasks/task-6.md`

## 1. Purpose of this document

This document translates the supplied visual references into explicit rules a
non-vision coding agent can implement without inventing a generic SaaS design.
It specifies the intended visual language, dimensions, tokens, typography,
component anatomy, page composition, responsive behavior, interaction states,
accessibility behavior, and visual QA process for Prism.

The target is not a clone of Command Code. Prism should inherit the reference's
precision, density, restraint, developer-tool character, and structural use of
hairlines while remaining an original analytics product with its own copy,
information architecture, identity, and data visualization needs.

When this document conflicts with a screenshot detail, use this priority:

1. Accessibility and functional clarity.
2. Prism product requirements and self-hosting constraints.
3. This written specification.
4. The user-supplied screenshots.
5. The live Command Code site.
6. Default shadcn styling.

Default shadcn styling is never the visual source of truth. shadcn provides the
accessible primitive behavior; Prism owns the appearance.

## 2. Design read

Prism is a developer-facing analytics product for technical founders,
engineers, and small product teams. It should feel like a reliable instrument:
dark, precise, inspectable, compact, fast, and honest about what is happening.

This is a redesign-overhaul. The current public index and auth pages are
temporary, so the new visual language may replace them completely. Existing
product route behavior and analytics concepts should remain recognizable.

Design dials:

| Dial | Value | Meaning |
| --- | ---: | --- |
| Design variance | 6/10 | Structured asymmetry, not experimental navigation |
| Motion intensity | 3/10 | Tactile feedback and short state transitions only |
| Visual density | 6/10 | Compact developer-tool UI with deliberate breathing room |

The dark theme is the canonical visual target because both references are dark.
A light theme must still exist for product accessibility and user preference,
but it should be a token-level translation, not a different brand.

## 3. What to inherit from the references

### 3.1 Workspace screenshot

The supplied workspace screenshot is approximately 1248 by 1085 pixels. Its
important characteristics are:

- A nearly black page with no decorative background texture or gradient.
- A wide content area inset approximately 28 pixels from the left and right.
- A mono-led welcome heading at the upper left.
- A very muted explanatory line directly under the heading.
- Section labels separated from content by substantial vertical space.
- A three-column usage grid with narrow 10-12 pixel gutters.
- Rectangular panels with 1 pixel borders and no visible rounding.
- Small square registration marks at selected panel corners and intersections.
- Metric labels set in small uppercase mono text.
- Large mono numeric values followed by much smaller muted units.
- Semantic icon color used sparingly: green, violet, and amber in the reference.
- A three-column quick-link row using the same grid and border system.
- Square icon wells inside quick-link panels.
- A large full-width onboarding/setup panel beneath the grids.
- Setup instructions rendered as numbered steps and dark code-copy rows.
- A small outlined documentation button aligned to the panel's upper right.
- No shadows, glass, large radii, gradients, or ornamental illustration in the
  dashboard itself.

### 3.2 Pricing screenshot

The supplied pricing screenshot is approximately 1313 by 1230 pixels. Its
important characteristics are:

- A thin violet line across the top edge of the viewport.
- A full-width black navigation bar approximately 84 pixels tall.
- A bright compact wordmark at the left, small muted nav links, and one white
  pill CTA at the right.
- A centered content rail approximately 1056 pixels wide, bounded by 1 pixel
  vertical borders.
- A centered headline region approximately 185 pixels tall.
- A bold sans headline with its latter phrase muted, not gradient-filled.
- A muted single-line subtitle.
- A framed introduction band with an eyebrow, a heading, explanatory copy, and
  restrained artwork.
- A pricing matrix that touches the rail edges and uses column dividers instead
  of detached cards.
- Large prices, tiny unit text, and small supporting detail on one baseline.
- CTA rows separated from plan descriptions by horizontal rules.
- A violet selection/tab and violet CTA for the active/highlighted option.
- Feature lists that use small functional icons and link blue where items are
  genuinely interactive.
- Very little rounding outside the global navigation CTA.

### 3.3 Live site content behavior

The live site reinforces these patterns:

- Direct, short developer-focused statements.
- Code and install commands are first-class calls to action.
- Functional `//` labels appear as a recurring voice device.
- Sections are dense but use strong borders and spacing to remain scannable.
- Technical specificity is preferred over generic marketing adjectives.

### 3.4 What not to copy

Do not reuse the Command Code logo, custom wordmark, mascot, illustrations,
copy, product names, testimonials, pricing, metrics, screenshots, or exact page
structure. Do not recreate its pages pixel for pixel. The references define a
design language, not reusable assets.

## 4. Prism's visual identity

### 4.1 Brand idea

Prism turns raw product activity into legible signals. The visual identity
should communicate:

- Instrumentation: clear readings, precise labels, obvious state.
- Realtime activity: live changes without visual noise.
- Transparency: no hidden cloud dependency for self-hosted operators.
- Developer ergonomics: API keys, SDK commands, and event payloads are native
  UI content rather than secondary documentation.
- Spectrum as data: multiple colors are permitted for actual chart series or
  statuses, but the interface itself uses one primary violet accent.

### 4.2 Shape language

Use a documented two-part radius system:

- Product panels, inputs, code rows, dialogs, menus, and normal buttons:
  `2px` radius.
- The single primary CTA in the global public navigation: `999px` radius.

No other pill controls are allowed by default. Tags and statuses are small
rectangles with a 2px radius. Avatars remain circular because they represent
people, not because pills are part of the design language.

### 4.3 Surface language

Hierarchy comes from these tools, in this order:

1. Spacing and alignment.
2. Text size, weight, and color.
3. One-pixel borders and dividers.
4. Slight surface-value changes.
5. Shadows only for floating overlays that must separate from content.

Do not wrap every group in a card. Dashboard rows may use a shared outer frame
with internal dividers. Marketing sections may use the central rail's edges as
their frame instead of creating detached containers.

## 5. Color system

### 5.1 Dark theme tokens

The hex values below are the visual source of truth for the first pass. Convert
to OKLCH only if the conversion is measured and does not visibly change them.

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#050506` | Viewport and primary page background |
| `canvas-subtle` | `#08080A` | Slightly differentiated page regions |
| `surface` | `#0B0B0E` | Inputs, code rows, compact inset areas |
| `surface-raised` | `#111116` | Menus, icon wells, elevated controls |
| `surface-hover` | `#17171D` | Hovered rows and controls |
| `surface-active` | `#1D1D25` | Pressed or selected neutral state |
| `border` | `#25252C` | Default hairlines and panel outlines |
| `border-strong` | `#383842` | Focused group edges and major dividers |
| `text` | `#F2F2F4` | Primary text and important numbers |
| `text-muted` | `#A3A3AD` | Descriptions, units, secondary nav |
| `text-subtle` | `#6B6B75` | Metadata, disabled copy, step numbers |
| `text-inverse` | `#09090B` | Text on white primary public CTA |
| `accent` | `#6547E8` | Prism action/selection violet |
| `accent-hover` | `#765AF0` | Hovered violet action |
| `accent-active` | `#5337CB` | Pressed violet action |
| `accent-soft` | `#241A5A` | Selected background without full emphasis |
| `focus` | `#9B89FF` | Keyboard focus ring |
| `link` | `#5F7DFF` | Inline documentation links |
| `success` | `#20D99A` | Connected, live, copied, successful |
| `warning` | `#F2A51A` | Delayed, attention, partial configuration |
| `danger` | `#F05D6C` | Destructive and error states |
| `info` | `#4DA3FF` | Informational state or chart series |
| `event` | `#BE5BE8` | Event-related semantic series |

Rules:

- `accent` is the only decorative/interactive brand color.
- `success`, `warning`, `danger`, `info`, and `event` require semantic meaning.
- A normal link uses `link`; a primary CTA uses `accent` or the public white
  CTA treatment.
- Never use a violet outer glow. Focus uses a crisp outline.
- Never use pure `#000000` or `#FFFFFF` as a page surface or body text.
- The 2px top rail may use `accent` as a solid color. Do not turn it into a
  rainbow gradient just because the product is named Prism.

### 5.2 Light theme tokens

| Token | Value |
| --- | --- |
| `canvas` | `#F6F6F8` |
| `canvas-subtle` | `#F0F0F3` |
| `surface` | `#FFFFFF` |
| `surface-raised` | `#F7F7F9` |
| `surface-hover` | `#EEEEF2` |
| `surface-active` | `#E6E6EC` |
| `border` | `#D8D8DF` |
| `border-strong` | `#BCBCC7` |
| `text` | `#111116` |
| `text-muted` | `#5D5D68` |
| `text-subtle` | `#7B7B87` |
| `text-inverse` | `#F7F7F9` |
| `accent` | `#5637D4` |
| `accent-hover` | `#482CB8` |
| `accent-active` | `#3D249F` |
| `accent-soft` | `#EAE5FF` |
| `focus` | `#5637D4` |
| `link` | `#3159D8` |
| `success` | `#087A55` |
| `warning` | `#9A6100` |
| `danger` | `#C72F45` |
| `info` | `#176FC1` |
| `event` | `#8B32B5` |

Light mode keeps the same hierarchy and radius system. It does not introduce
warm paper colors, shadows on every card, or a separate marketing identity.

### 5.3 Suggested Tailwind CSS 4 token skeleton

```css
:root {
  color-scheme: light;
  --canvas: #f6f6f8;
  --canvas-subtle: #f0f0f3;
  --surface: #ffffff;
  --surface-raised: #f7f7f9;
  --surface-hover: #eeeef2;
  --surface-active: #e6e6ec;
  --border: #d8d8df;
  --border-strong: #bcbcc7;
  --text: #111116;
  --text-muted: #5d5d68;
  --text-subtle: #7b7b87;
  --accent: #5637d4;
  --accent-hover: #482cb8;
  --accent-active: #3d249f;
  --accent-soft: #eae5ff;
  --focus: #5637d4;
  --link: #3159d8;
  --success: #087a55;
  --warning: #9a6100;
  --danger: #c72f45;
  --info: #176fc1;
  --event: #8b32b5;
  --radius-control: 2px;
  --radius-global-cta: 999px;
}

.dark {
  color-scheme: dark;
  --canvas: #050506;
  --canvas-subtle: #08080a;
  --surface: #0b0b0e;
  --surface-raised: #111116;
  --surface-hover: #17171d;
  --surface-active: #1d1d25;
  --border: #25252c;
  --border-strong: #383842;
  --text: #f2f2f4;
  --text-muted: #a3a3ad;
  --text-subtle: #6b6b75;
  --accent: #6547e8;
  --accent-hover: #765af0;
  --accent-active: #5337cb;
  --accent-soft: #241a5a;
  --focus: #9b89ff;
  --link: #5f7dff;
  --success: #20d99a;
  --warning: #f2a51a;
  --danger: #f05d6c;
  --info: #4da3ff;
  --event: #be5be8;
}

@theme inline {
  --color-background: var(--canvas);
  --color-foreground: var(--text);
  --color-card: var(--surface);
  --color-card-foreground: var(--text);
  --color-popover: var(--surface-raised);
  --color-popover-foreground: var(--text);
  --color-border: var(--border);
  --color-input: var(--border-strong);
  --color-ring: var(--focus);
  --color-primary: var(--accent);
  --color-primary-foreground: #f7f7f9;
  --color-muted: var(--surface-raised);
  --color-muted-foreground: var(--text-muted);
  --color-destructive: var(--danger);
  --radius-sm: var(--radius-control);
  --radius-md: var(--radius-control);
  --radius-lg: var(--radius-control);
}
```

## 6. Typography

### 6.1 Font families

Use self-hosted fonts with `font-display: swap`:

- UI/body/display sans: Geist Sans.
- Code/data/labels: Geist Mono.

If licensing or packaging prevents Geist, use IBM Plex Sans and IBM Plex Mono
as the fallback pair. Do not load fonts from Google Fonts or another CDN.

Fallback stacks:

```css
--font-sans: "Geist", "Helvetica Neue", Arial, sans-serif;
--font-mono: "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
```

### 6.2 Type scale

| Role | Desktop | Mobile | Font | Weight | Tracking | Line height |
| --- | --- | --- | --- | ---: | --- | ---: |
| Marketing display | 52px | 38px | Sans | 650 | `-0.045em` | 1.02 |
| Marketing H1 long | 40px | 34px | Sans | 650 | `-0.035em` | 1.08 |
| Product page title | 26px | 22px | Mono | 650 | `-0.025em` | 1.18 |
| Product section title | 18px | 17px | Sans | 600 | `-0.015em` | 1.25 |
| Panel title | 15px | 15px | Sans | 550 | `-0.01em` | 1.3 |
| Body | 14px | 14px | Sans | 400 | `0` | 1.55 |
| Body small | 13px | 13px | Sans | 400 | `0` | 1.5 |
| Label | 11px | 11px | Mono | 500 | `0.09em` | 1.3 |
| Metadata | 11px | 11px | Mono | 400 | `0.04em` | 1.35 |
| Code | 13px | 12px | Mono | 400 | `0` | 1.5 |
| Metric large | 32px | 28px | Mono | 650 | `-0.04em` | 1 |
| Pricing/hero number | 48px | 40px | Sans | 600 | `-0.055em` | 1 |
| Button | 13px | 13px | Sans | 550 | `-0.005em` | 1 |

### 6.3 Type rules

- Product page titles use mono because the dashboard screenshot establishes
  that voice. Marketing headlines use sans because the pricing screenshot does.
- Metric values and API-related strings always use mono with tabular numerals.
- Units sit on the same baseline as values but use body-small sizing and muted
  color.
- Uppercase labels are reserved for functional categories such as `USAGE
  SUMMARY`, `API KEY`, or `LIVE`. Do not put uppercase eyebrows above every
  marketing section.
- Use `//` before selected product/public headings, not all headings. Maximum one
  `//` heading in every three major page sections.
- Never use a placeholder as a form label.
- Avoid em dashes in visible copy. Use a period, comma, colon, or normal hyphen.
- Do not use fake terminal slang or cute copy merely to sound technical.

## 7. Spacing, sizing, and layout

### 7.1 Spacing scale

Use a 4px base:

| Token | Pixels |
| --- | ---: |
| `1` | 4 |
| `2` | 8 |
| `3` | 12 |
| `4` | 16 |
| `5` | 20 |
| `6` | 24 |
| `7` | 28 |
| `8` | 32 |
| `10` | 40 |
| `12` | 48 |
| `14` | 56 |
| `16` | 64 |
| `20` | 80 |
| `24` | 96 |

Do not add arbitrary 17px, 23px, or 37px gaps unless optical alignment requires
it and a comment explains why.

### 7.2 Public content rail

The pricing screenshot uses a framed central rail. Prism's public pages should
use:

- Maximum rail width: `1120px`.
- Desktop viewport gutter: minimum `32px`.
- Rail border: 1px left and right using `border`.
- Public top navigation: full viewport width with a bottom border.
- Page sections within the rail may touch its border and use internal padding.
- Typical section horizontal padding: `40px` desktop, `24px` tablet, `16px`
  mobile.
- Major public section vertical padding: `72-96px` desktop, `48-64px` mobile.

At 1313px wide, a 1120px rail leaves approximately 96px on each side. This is
close to the reference while giving Prism a round implementation number.

### 7.3 Product content area

The workspace screenshot uses a much wider product canvas:

- Product max width: `1800px`.
- Desktop gutters: `28px` from 1024-1439, `40px` at 1440 and above.
- Tablet gutters: `20px`.
- Mobile gutters: `16px`.
- Default three-column grid gap: `12px`.
- Default two-column grid gap: `12px` or `16px` depending on content density.
- Product section gap: `36-44px`.
- Space from page introduction to first section label: `40px`.
- Space from section label to its grid/frame: `14-16px`.

### 7.4 Breakpoints

| Name | Width | Main behavior |
| --- | --- | --- |
| Narrow | `<480px` | Single column, 16px gutters, compact nav |
| Mobile | `480-767px` | Single column, full-width controls |
| Tablet | `768-1023px` | Two-column metrics/links where useful |
| Desktop | `1024-1439px` | Full public rail and three-column product grid |
| Wide | `>=1440px` | Wider product gutters; content max remains bounded |

Do not rely on accidental flex wrapping. Every component must declare its
layout at narrow, tablet, and desktop widths.

## 8. The structural frame pattern

The registration-marked frame is the strongest visual motif from the workspace
screenshot. Use it carefully.

### 8.1 Base frame

- Border: `1px solid var(--border)`.
- Background: transparent for large page sections; `surface` for compact inset
  controls.
- Radius: 2px.
- Default padding: 24px.
- Position: relative.
- No shadow.

### 8.2 Corner registration marks

Use four 5px by 5px squares centered over the frame's corners:

- Color: `border-strong`.
- Position offset: `-3px` from each corner.
- `pointer-events: none`.
- `aria-hidden: true` if represented in markup; pseudo-elements are preferred.
- Do not animate them.

Because one element has only two pseudo-elements, implement marks either with a
small reusable `FrameCorners` child or with nested wrapper pseudo-elements.

Use registration marks on:

- Metric grid cells in the overview.
- Quick-link cells in the overview.
- The main setup/onboarding frame.
- Important empty states that replace those frames.
- Optional public comparison matrices.

Do not use them on:

- Every input, button, dropdown, toast, dialog, or table row.
- Marketing hero text.
- Mobile panels narrower than 360px, where they become noise.

### 8.3 Shared-grid borders

For side-by-side cells, avoid doubled borders:

- Prefer one parent border plus internal `border-inline-start` dividers.
- If cells remain independent for responsive reordering, use a 12px gap as in
  the workspace screenshot.
- Pricing/comparison matrices use a shared parent and internal zero-gap
  dividers, as in the pricing screenshot.

## 9. Primitive component specifications

### 9.1 Global public navigation

Desktop:

- Height: 72px. Absolute maximum: 80px.
- Top accent rail: 2px solid `accent`.
- Bottom border: 1px `border`.
- Inner max width: 1200px, centered, 32px horizontal padding.
- Logo: left aligned, 26-32px visual height.
- Nav links: 13px sans, muted color, 32px gap.
- Active link: primary text, no colored pill or underline by default.
- Right actions: `Sign in` as text/ghost, `Get started` as the single white pill.
- White CTA: off-white background, `text-inverse`, height 38px, 20px horizontal
  padding, full radius.

Mobile:

- Height: 60px plus 2px rail.
- Logo at left, menu button at right.
- Menu opens a full-width sheet below the nav, not a tiny floating dropdown.
- The menu lists links as 48px rows separated by one bottom border.
- Primary CTA appears once at the bottom of the sheet.

### 9.2 Product navigation

- Height: 56px desktop, 52px mobile.
- Background: canvas with optional 92% opacity only when sticky.
- Bottom border: 1px `border`.
- No blur is required; if used, supply an opaque fallback.
- Left: Prism wordmark and team switcher.
- Center or left continuation: project nav when a project is active.
- Right: docs, theme, and user menu.
- Active route: primary text plus a 1px bottom edge in `accent`, not a filled
  pill.
- Focus-visible: 2px `focus` outline with 2px offset.

### 9.3 Buttons

Common dimensions:

- Small: 30px high, 12px horizontal padding.
- Default: 36px high, 14px horizontal padding.
- Large: 42px high, 18px horizontal padding.
- Icon-only default: 36px square.
- Radius: 2px except the global public nav CTA.
- Label: 13px, 550 weight, one line.

Variants:

- Primary: `accent` background, off-white text, accent border.
- Public primary: off-white background, dark text.
- Secondary: transparent/canvas background, `border-strong`, primary text.
- Ghost: transparent, no border, hover uses `surface-hover`.
- Destructive: transparent or danger-soft background, danger text/border. Use a
  filled danger button only at the final destructive confirmation.
- Link: no container, link color, underlined on hover and focus.

States:

- Hover: background or border changes in 120ms.
- Active: translate down 1px or scale to 0.99 for 80ms.
- Focus-visible: 2px outline, 2px offset.
- Disabled: 45% opacity, no translation, explanatory tooltip only when the
  reason is not already visible.
- Busy: retain label width; show a 12px progress glyph beside the label and set
  `aria-busy=true`.

### 9.4 Inputs

- Height: 40px.
- Background: `surface`.
- Border: 1px `border-strong`.
- Radius: 2px.
- Horizontal padding: 12px.
- Text: 14px sans; API keys/code inputs may use 13px mono.
- Placeholder: `text-subtle`, but never used instead of a visible label.
- Label: 12px sans or 11px mono, primary text, 8px above input.
- Helper/error: 12px, 6px below input.
- Focus: border changes to `focus` plus a 2px outer outline.
- Error: danger border and error message. Do not use color alone; include text
  and an icon when useful.

### 9.5 Icon well

Used by quick links and compact actions:

- Size: 36px square.
- Background: `surface-raised`.
- Border: 1px `border`.
- Radius: 2px.
- Icon: 16px, 1.5px stroke, muted by default.
- Semantic icons may use semantic color only when the state is real.

Continue using Lucide because it is already the project's icon family. Do not
mix in a second outline icon family.

### 9.6 Code-copy row

- Height: 42px minimum.
- Width: 100% of its instruction column.
- Background: `surface-raised`.
- No extra border when it sits inside a framed setup panel; otherwise use a
  1px border.
- Prompt prefix: `$` in `text-subtle`, 13px mono.
- Command: 13px mono, primary text, horizontally scrollable on narrow screens.
- Copy action: 36px square at the right.
- Hover only highlights the copy action, not the entire code block.
- On success, replace the copy icon with a check for 1500ms and announce
  `Copied` through an ARIA live region.
- Never place a real secret/API key in a public screenshot or test fixture.

### 9.7 Section label

Product label:

- 11px mono.
- Uppercase.
- `0.09em` tracking.
- `text-muted` color.
- Optional `//` prefix in `text-subtle`.

Marketing label:

- Same type, but use at most once every three sections.
- Prefer direct headings without labels for most sections.
- Never number sections just for decoration.

### 9.8 Metric frame

Desktop:

- Minimum height: 108px.
- Padding: 20px 22px.
- Header row: 12px icon, 10px gap, 11px uppercase mono label.
- Value row: 18px top margin.
- Value: 30-32px mono, weight 650, tabular numerals.
- Unit: 12px sans, `text-subtle`, 8px left gap, baseline aligned.
- Optional change indicator: below value, 11px mono, semantic color plus text.

Do not display a perfect zero/loading value before data exists. Use a metric-
shaped skeleton, then render `0` only after a successful empty response.

### 9.9 Quick-link frame

- Minimum height: 128px.
- Padding: 20px.
- Top row: icon well plus 15px title.
- Description: 13px muted, max 2 lines, max width 36ch.
- Entire frame may be clickable if it contains only one destination.
- Hover: `surface-hover` and `border-strong` over 120ms.
- Include a visible focus ring around the entire frame.
- Do not add a decorative arrow unless it clarifies navigation.

### 9.10 Dialog and sheet

- Dialog max width: 480px for simple forms; 640px for multi-section settings.
- Surface: `surface-raised`.
- Border: 1px `border-strong`.
- Radius: 2px.
- Shadow: `0 24px 80px rgb(0 0 0 / 0.45)` in dark mode only because the
  overlay is genuinely elevated.
- Overlay: black at 68% opacity. No backdrop glow.
- Header/body/footer separated by spacing first; use one divider only when the
  footer needs a strong action boundary.
- Focus trap, escape handling, initial focus, and focus restoration are
  mandatory.

## 10. Public landing page specification

### 10.1 Page objective

Explain Prism in under one minute and give two legitimate next paths:

- Start on hosted Prism.
- Self-host Prism without creating a Prism cloud account.

Do not make self-hosting look like a secondary legal link. It is a core product
choice, but the hosted signup remains the primary conversion action.

### 10.2 Desktop wireframe

```text
2px VIOLET TOP RAIL
┌──────────────────────────────────────────────────────────────────────┐
│ PRISM             Product  Docs  Self-host      Sign in  Get started│ 72
└──────────────────────────────────────────────────────────────────────┘

     ┌──────────────────────── PUBLIC RAIL 1120 ──────────────────────┐
     │                                                                │
     │ // REAL-TIME PRODUCT ANALYTICS                                 │
     │ See what people do.                                            │
     │ As it happens.                                                  │
     │                                                                │
     │ Track sessions and product events with a small SDK. Run Prism  │
     │ with us or on your own infrastructure.                          │
     │                                                                │
     │ [Start hosted] [Self-host Prism]                                │
     │                                                                │
     │                   [REAL PRODUCT SCREENSHOT, 16:10]              │
     │                                                                │
     ├────────────────────────────────────────────────────────────────┤
     │ LIVE SIGNALS             EVENTS              YOUR DATA          │
     │ real product metric      real product metric deployment fact   │
     ├────────────────────────────────────────────────────────────────┤
     │ Connect a project                                               │
     │ Install SDK -> add project key -> verify first event            │
     │ [actual code examples and copy controls]                        │
     ├────────────────────────────────────────────────────────────────┤
     │ Realtime view            Event timeline                         │
     │ [real screenshot]        [real screenshot / data capture]       │
     ├────────────────────────────────────────────────────────────────┤
     │ Hosted Prism                     Self-host Prism                 │
     │ managed infrastructure           your infrastructure            │
     │ [Start hosted]                    [Deployment guide]             │
     ├────────────────────────────────────────────────────────────────┤
     │ Documentation CTA and compact footer                            │
     └────────────────────────────────────────────────────────────────┘
```

### 10.3 Hero

- Minimum height: `calc(100dvh - 74px)` with a practical minimum of 620px and
  maximum content height near 760px.
- Use `min-height`, never `height: 100vh`.
- Layout: 12-column grid. Copy spans 5 columns; screenshot spans 7 columns.
- Gap: 40px.
- Hero padding: 72px top/bottom desktop, 48px tablet, 40px mobile.
- Eyebrow: optional and counts as the page's first permitted micro-label.
- Headline: maximum 2 lines on desktop, 52px. Proposed copy:
  `See what people do. As it happens.`
- Body: maximum 20 words if possible; never more than 4 lines.
- CTA row: primary `Start hosted`; secondary `Self-host Prism`.
- Use one actual Prism screenshot captured after the dashboard redesign. Give it
  explicit dimensions and border treatment. Do not create a fake dashboard from
  decorative divs.
- No animated gradient, cursor follower, floating badges, trust avatar row,
  pricing teaser, or scroll instruction.

### 10.4 Proof/metric band

Until Prism has real public metrics, show product facts rather than invented
numbers. Example columns:

- `REALTIME` - WebSocket session updates.
- `EVENTS` - Structured product event payloads.
- `YOUR DATA` - Hosted or self-hosted storage.

Use a shared frame with three columns and internal dividers. Do not imitate the
workspace metric cards with fake counts.

### 10.5 Setup section

This is the public counterpart to the workspace setup panel:

- Heading: `Connect a project`.
- Subcopy: one sentence.
- Steps use verb labels, not `Step 1`, `Step 2`, `Step 3` headings:
  `Install`, `Initialize`, `Verify`.
- Code rows show real SDK syntax from current Prism docs.
- A framework switcher may offer `JavaScript` and `React`; it uses rectangular
  tabs with one violet selected state.
- The final state explains how the first event will appear in Prism.
- Provide one `Read the docs` outlined button.

### 10.6 Hosted vs self-hosted section

Use a two-column shared frame, not two floating pricing cards.

Hosted column:

- Managed API and databases.
- Create an account.
- Fastest path to first event.
- Primary CTA: `Start hosted`.

Self-hosted column:

- Operator-owned infrastructure and data.
- No Prism cloud account required.
- Link to requirements and deployment guide.
- Secondary CTA: `Deployment guide`.

Do not claim one-command deployment until Task 6's artifacts and CI smoke test
exist.

## 11. Authentication page specification

### 11.1 Shared auth shell

Avoid a generic small card floating in the exact center of an empty page.

Desktop:

- Global public nav remains visible.
- Main auth frame: max width 1040px, minimum height 600px, centered within the
  public rail with 56px vertical margin.
- Two-column zero-gap grid: context panel 42%, form panel 58%.
- One border around the frame plus one vertical divider.
- Context panel: `canvas-subtle`, 40px padding.
- Form panel: canvas, 56px horizontal and 48px vertical padding.
- Form itself: max width 420px, left aligned.

Mobile:

- Hide the long context copy, but keep logo/instance identity and one sentence.
- Remove the vertical divider and use one horizontal divider if needed.
- Form uses 16px page gutters and full-width actions.
- Minimum touch target: 44px.

### 11.2 Auth shell wireframe

```text
┌────────────────────────────────────────────────────────────────────┐
│ PRISM                                             Docs   Self-host │
└────────────────────────────────────────────────────────────────────┘

      ┌───────────────────────┬────────────────────────────────┐
      │ // PRISM              │ // SIGN IN                     │
      │                       │ Welcome back.                  │
      │ Realtime product      │ Use your account to continue. │
      │ analytics you can run │                                │
      │ yourself.             │ [Continue with GitHub]         │
      │                       │ [Continue with Google]         │
      │ Hosted instance       │ -------- OR EMAIL --------     │
      │ app.prism...          │ Email                          │
      │                       │ [                            ] │
      │                       │ Password                       │
      │                       │ [                            ] │
      │                       │ [Sign in]                      │
      │                       │ Forgot password                │
      └───────────────────────┴────────────────────────────────┘
```

### 11.3 Sign-in

- Heading: `Welcome back.`
- Description: `Use your Prism account to continue.`
- Provider order: GitHub, then Google, then email/password.
- Provider buttons: secondary outlined, 42px high, full width, icon at left,
  label centered optically.
- Hide a provider button completely when the instance has no credentials for
  it. Do not show a disabled provider as an advertisement.
- Divider label: `OR EMAIL`, 10px mono, with one hairline on each side.
- Password includes a text show/hide action. Do not use an icon without an
  accessible name.
- Primary button label: `Sign in`, not `Login`.
- Links: `Forgot password` and `Create account`.
- During auth, keep button width stable and use a small inline busy indicator.

### 11.4 Create account

- Heading: `Create your account.`
- Keep provider actions first.
- Email form fields: name, email, password. Do not request fields that onboarding
  can collect later unless they are required to provision a profile.
- Show password requirements before submission.
- Include concise terms/privacy consent only when legal copy is ready. Never
  invent consent text.
- Successful submission transitions to an email-verification state in the same
  shell.
- Hosted copy says `Create a Prism account`.
- Self-hosted copy says `Create an account on <instance name>` and must never
  imply registration with Prism cloud.

### 11.5 Verification/reset/callback states

All use the same shell and form-panel width:

- Verify email: envelope icon well, destination email partially redacted,
  resend action with cooldown text.
- Forgot password: one email field, generic success response whether or not the
  account exists.
- Reset password: new password, confirm password, visible requirements, expired
  link state.
- OAuth pending: stable skeleton with provider name and cancel/back option after
  a reasonable delay.
- OAuth denied: plain explanation and return to sign-in.
- Account not linked: identify the original method if safely known; provide an
  explicit link-account path only after reauthentication.
- Invalid/expired invite: explain state and provide a sign-in or request-new-
  invite action.
- Offline/API unavailable: do not report invalid credentials when the network
  is the problem.

## 12. First-run onboarding specification

The onboarding must feel like the workspace screenshot's `GET STARTED` panel,
not a generic full-screen wizard with oversized illustrations.

### 12.1 Hosted onboarding sequence

1. Confirm profile.
2. Confirm/create workspace.
3. Create project.
4. Show analytics key once, safely redacted after initial reveal.
5. Install SDK.
6. Wait for first session/event.
7. Enter the project overview.

### 12.2 Self-hosted onboarding sequence

1. Create the first local owner.
2. Name the local instance.
3. Choose registration policy.
4. Show optional email/OAuth integration status.
5. Create first project and key.
6. Install SDK.
7. Verify first event without contacting Prism cloud.

### 12.3 Onboarding layout

- Use the public rail before authentication and product content width after the
  account exists.
- Main frame: full available width, minimum 520px high.
- Left instruction column: 58%.
- Right status column: 42%, separated by one vertical divider.
- Left shows current action and code rows.
- Right shows a compact checklist with real state: waiting, complete, error.
- Progress is communicated through checked actions and a `3 of 6` text label,
  not a decorative filled progress bar.
- Do not auto-advance while a user is copying or reading a key.
- Resume state must survive refresh.
- `Skip for now` is a text action, not a second primary button.

## 13. Product dashboard specification

### 13.1 Workspace overview

This page is the direct Prism adaptation of the first supplied screenshot.

Recommended Prism content:

- Heading: `// Welcome back, <first name>`.
- Subheading: `Overview of your Prism workspace`.
- Section: `USAGE SUMMARY`.
- Metrics: `VISITORS`, `SESSIONS`, `EVENTS` for the selected date range.
- Section: `QUICK LINKS`.
- Links: `Projects`, `API keys`, `Documentation` or `Team settings` depending on
  actual priority.
- Section: `// GET STARTED` only until the first project successfully sends data.
- Setup panel: `Connect your first project` with install, initialize, verify.
- After activation, replace setup with `RECENT ACTIVITY` and retain setup under
  project settings/docs.

### 13.2 Workspace overview desktop geometry

At a 1248px viewport:

- Left/right gutter: 28px.
- Heading top: approximately 32px below product nav/content start.
- Heading-to-subheading gap: 8px.
- Introduction-to-first-label gap: 42px.
- Label-to-metric-grid gap: 14px.
- Metric cells: three equal columns, 12px gap, 108px minimum height.
- Metric-grid-to-quick-label gap: 38px.
- Quick-link cells: three equal columns, 12px gap, 128px minimum height.
- Quick-grid-to-setup-label gap: 46px.
- Setup panel: full width, minimum 440px; content padding 24px.

### 13.3 Workspace overview wireframe

```text
// Welcome back, David
Overview of your Prism workspace

USAGE SUMMARY
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ ● VISITORS         │  │ ◆ SESSIONS         │  │ ■ EVENTS           │
│ 1,284 this period  │  │ 1,907 sessions     │  │ 6,421 events       │
└────────────────────┘  └────────────────────┘  └────────────────────┘

QUICK LINKS
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ [icon] Projects    │  │ [icon] API keys    │  │ [icon] Docs        │
│ Manage tracked     │  │ Create and rotate  │  │ Install and use    │
│ applications.      │  │ project keys.      │  │ the Prism SDK.     │
└────────────────────┘  └────────────────────┘  └────────────────────┘

// GET STARTED
┌─────────────────────────────────────────────────────────────────────┐
│ Connect your first project                            [View docs]   │
│ Add the Prism SDK and verify the first event.                       │
│                                                                     │
│ Install                                                             │
│ $ yarn add @prism/core                                      [copy] │
│ Initialize                                                          │
│ $ const prism = new PrismClient(...)                        [copy] │
│ Verify                                                              │
│ Waiting for the first event...                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The symbols above represent library icons, not literal hand-drawn glyphs.
Values in implementation must come from real data. Story/gallery fixtures must
be labeled as sample data.

### 13.4 Project summary

Layout order:

1. Project title, domain/environment, date range, compact actions.
2. Four-metric shared frame on wide screens; two-by-two tablet; stacked mobile.
3. Main trend chart spanning 8 columns plus realtime/health summary spanning 4.
4. Referrer and location rankings in a two-column row.
5. Recent sessions or activity.

Rules:

- Charts sit inside framed sections but do not receive registration marks on
  every data point.
- Chart gridlines use `border` at low opacity.
- Axis labels use 11px mono, muted.
- Tooltip uses `surface-raised`, one border, 2px radius, no glow.
- Chart series use semantic palette colors with patterns/labels where color
  alone is insufficient.
- Empty charts show a setup/action state, not an artificial flat line.

### 13.5 Events page

- Header contains project title context, event count, date range, and search.
- Use a table/list optimized for scanability, not detached cards per event.
- Row height: 48-56px.
- Columns: event name, count, unique sessions, most recent time.
- Event name uses 13px mono.
- Selecting a row opens a detail panel with properties and recent payloads.
- JSON uses a real code viewer with wrapping/copy behavior, not a textarea.
- Property values must redact known sensitive fields and truncate huge values.
- Mobile changes to a two-line row; secondary columns move under the event name.

### 13.6 Realtime page

- Header includes a semantic live indicator, connection state text, current
  online count, and optional reconnect action.
- Desktop: map/visualization 8 columns, live session list 4 columns.
- Without Mapbox: session list expands to full width and includes country/city
  text when enrichment exists. Do not show a broken empty map rectangle.
- A live dot may pulse because it represents actual state. Disable pulse under
  reduced motion and always pair it with `Live`, `Reconnecting`, or `Offline`.
- New sessions enter with a 150ms opacity transition only.
- Connection failures remain visible until resolved; do not rely on a transient
  toast.

### 13.7 API keys page

- Keys are treated as developer workflow content.
- Shared frame with key name, masked value, created date, last-used date, and
  actions.
- Reveal is explicit and temporary. Copy does not require leaving the page.
- Rotation is a destructive-impact dialog that explains SDK updates.
- A newly created key is shown once in a high-contrast code row with a copy
  action and a confirmation checkbox before dismissal if the server cannot show
  it again.
- Never use real keys in screenshots, visual tests, or documentation.

### 13.8 Settings/account pages

- Desktop: 220px local section navigation plus a 640px content column.
- Use a vertical border, not a floating sidebar card.
- Form sections are grouped by heading and spacing. Avoid a card around each
  field.
- Destructive zone appears last and uses one danger border at its top.
- Connected accounts show provider icon, email/handle, linked date, and an
  unlink action. Prevent unlinking the final sign-in method.
- Session management lists device/browser, approximate location if available,
  last active, and revoke action.

## 14. Pricing and comparison pattern

Prism pricing is not yet defined, so do not invent plan names, prices, quotas,
or customer claims. If a pricing or hosted-vs-self-hosted matrix is added later,
use the second screenshot's structure:

- Centered 1120px framed rail.
- Headline region with centered H1 and one-line subtitle.
- Introduction band above the matrix.
- One shared matrix frame with vertical column dividers, not floating cards.
- Plan price uses 48px sans; unit uses 11px muted text.
- CTA occupies its own full-width row in each column.
- One active/recommended option may use a solid violet CTA/tab.
- Feature groups use functional icons and real links only.
- On mobile, convert the matrix to a plan selector plus one visible plan rather
  than squeezing three columns or creating an endless horizontal page.
- Comparison tables should use sticky headers and horizontal scrolling only
  when the data genuinely requires side-by-side comparison.

## 15. Loading, empty, error, and success states

Every route/component must implement all relevant states before it is complete.

### 15.1 Loading

- Use skeletons that match the final component geometry.
- Metric skeleton: 72px label/value block inside the real 108px frame.
- Table skeleton: 5-8 rows with varied but deterministic text widths.
- Auth session bootstrap: stable shell and form skeleton; never flash the wrong
  router.
- Do not use a full-page centered spinner for normal route data.

### 15.2 Empty

Empty states stay inside the component's normal frame and answer:

1. What is empty?
2. Why might it be empty?
3. What is the one next action?

Examples:

- No projects: `Create a project`.
- No events: show SDK event snippet plus `Read event docs`.
- No sessions in range: change range or verify installation.
- No map token: explain that the list remains available and link to local
  configuration.

### 15.3 Error

- Inline for form validation.
- Persistent contextual alert for route/API failure.
- Toast only for transient operations such as copied/saved.
- Include retry when retry is safe.
- Never show raw stack traces, SQL errors, provider tokens, or full third-party
  response payloads.

### 15.4 Success

- Prefer in-place state changes: button label, status text, or updated data.
- Copy success lasts approximately 1500ms.
- Saved settings may use a short toast plus updated timestamp.
- Destructive completion returns focus to the logical next control.

## 16. Interaction and motion

Motion communicates feedback and state, not atmosphere.

| Interaction | Duration | Easing/behavior |
| --- | ---: | --- |
| Color/border hover | 120ms | ease-out |
| Button press | 80ms | 1px translate or 0.99 scale |
| Dropdown/popover enter | 140ms | opacity + 4px translate |
| Dialog enter | 180ms | opacity + 0.985 to 1 scale |
| Route content reveal | 160ms | opacity only, optional |
| New realtime row | 150ms | opacity only |
| Skeleton shimmer | 1400ms | only if reduced motion is off |

Rules:

- Animate only transform and opacity.
- No parallax, scroll hijacking, custom cursor, magnetic buttons, or perpetual
  decorative animation.
- No `window` scroll listener that writes to React state.
- Respect `prefers-reduced-motion`; all interface behavior must remain clear
  with transitions disabled.
- A live pulse is allowed only for real live connection state.

## 17. Responsive behavior

### 17.1 Public pages

- Below 1024px, hero becomes a vertical stack with text before screenshot.
- Below 768px, remove public rail side borders if they create a cramped double
  gutter; retain section top/bottom borders.
- Marketing H1 reduces to 38px and remains at most 3 lines on very narrow
  screens.
- CTA row stacks only below 480px. Each CTA becomes full width.
- Hosted/self-hosted comparison becomes two vertically stacked sections with a
  single divider.
- Real screenshots remain full width with fixed aspect ratio and no horizontal
  page scroll.

### 17.2 Product overview

- Three metrics: 3 columns desktop, 2 plus 1 tablet, 1 mobile.
- Three quick links: 3 columns desktop, 1 column below 768px.
- Setup panel instruction/status columns stack below 900px.
- Registration marks are removed below 360px if they collide with viewport
  gutters.
- Metric value/unit may wrap only at extremely narrow widths; prefer smaller
  metric type down to 26px.

### 17.3 Tables and charts

- Preserve table semantics.
- On mobile, hide low-priority columns or convert rows to deliberate two-line
  layouts. Do not make every product page a sideways-scrolling desktop table.
- Charts reduce tick count and legend density rather than shrinking labels below
  11px.
- Touch tooltips must open on tap and close predictably.

## 18. Accessibility requirements

- WCAG AA minimum contrast for all text and controls; target AAA for normal body
  text on canonical dark surfaces.
- All interactive elements have visible focus indicators.
- Focus order follows visual order.
- Icon-only controls have accessible names and 44px touch targets on mobile.
- Authentication fields use correct `autocomplete` values.
- Validation messages are connected through `aria-describedby`.
- Loading uses `aria-busy`; copy and save confirmations use polite live regions.
- Live realtime updates do not continuously interrupt screen readers. Provide a
  manually readable count/list update region.
- Charts include text summaries or accessible data tables.
- Maps never contain the only representation of session data.
- Semantic state is never color-only. Pair color with text/icon/shape.
- Dialogs and sheets trap focus, close with Escape when safe, and restore focus.
- Respect reduced motion and system color preference.
- Test at 200% zoom and 320 CSS pixel width without loss of content/function.

## 19. Copy and content voice

Prism copy is:

- Direct.
- Technical but readable.
- Specific about actions and data.
- Calm rather than excited.
- Honest about hosted and self-hosted capabilities.

Preferred:

- `Connect your first project.`
- `Waiting for the first event.`
- `This key can write analytics data. It cannot read project data.`
- `Run Prism on your own infrastructure.`
- `No sessions were recorded in this date range.`

Avoid:

- `Unleash the power of next-generation analytics.`
- `Elevate your insights seamlessly.`
- `Your analytics journey starts here.`
- Fake performance numbers or customer counts.
- Cute labels that do not explain the feature.
- Excessive terminal prefixes on normal prose.

Use `//` as a restrained brand voice marker. It is not required before every
heading.

## 20. Self-hosting design requirements

- Display the instance name in auth and account surfaces.
- Self-hosted mode may show a small rectangular `SELF-HOSTED` metadata label in
  the product nav. It is informational, not a marketing badge.
- Never display `Create a Prism cloud account` in self-hosted mode.
- First-admin bootstrap must clearly say the account belongs to this instance.
- Optional provider status uses explicit rows: configured, not configured,
  unavailable.
- Missing Google, GitHub, Resend, ImageKit, IPinfo, or Mapbox must not make the
  UI appear broken.
- External links and outbound integrations should be identifiable before the
  user enables them.
- Update/diagnostic opt-ins must explain what data leaves the instance.
- Deployment health uses semantic status text and timestamps, not decorative
  green dots alone.

## 21. shadcn component mapping

Use current shadcn components for behavior, then style them to this spec.

| Prism pattern | shadcn/Radix basis | Required customization |
| --- | --- | --- |
| Button | Button | 2px radius, Prism variants, stable busy state |
| Form field | Form/Input/Label | 40px input, strong focus, inline errors |
| Dialog | Dialog | Sharp frame, restrained overlay/shadow |
| Mobile nav | Sheet | Full-width row layout, product tokens |
| Menus | Dropdown Menu | Dense 32-36px rows, sharp surface |
| Project selector | Command/Popover | Mono metadata, keyboard search |
| Tabs | Tabs | Rectangular, border-based, violet active state |
| Alerts | Alert | Inline contextual treatment, no generic card look |
| Toast | Sonner | Transient feedback only |
| Skeleton | Skeleton | Geometry-specific variants |
| Charts | Chart/Recharts | Prism series, mono axes, accessible summary |
| Date range | Calendar/Popover | Dense product treatment and mobile sheet |

Prism-specific composites must not remain in `components/ui`. Place them under
feature or layout directories, for example:

```text
components/
  ui/                 # shadcn-derived primitives only
  frames/             # Frame, FrameCorners, MetricFrame
  auth/               # AuthShell, ProviderButton, AuthState
  onboarding/         # SetupPanel, SetupAction, ConnectionStatus
  dashboard/          # UsageSummary, QuickLinks, RecentActivity
  projects/           # ProjectHeader, ApiKeyRow, EventTable
  layout/             # PublicNav, ProductNav, PublicRail
```

## 22. Agent implementation contract

A non-vision coding agent must follow this sequence:

1. Read this entire document and the relevant task file.
2. Inventory existing components and route behavior before editing.
3. Implement tokens and typography first.
4. Build/verify primitives in a component gallery.
5. Build the shared public rail, nav, frame, and auth shell.
6. Implement one route at a time with all states.
7. Capture a screenshot at the exact QA widths.
8. Compare against this document and the supplied references.
9. Fix visual hierarchy before adding any motion.
10. Run accessibility, responsive, and quality gates.

The agent must not guess when a required asset or business claim is missing.
Use a clearly named placeholder slot and report the missing input. Never create
a fake customer logo, testimonial, product metric, price, or API key.

## 23. Visual QA matrix

Capture these viewports for every major page:

| Target | Width x height |
| --- | --- |
| Narrow mobile | 320 x 720 |
| Standard mobile | 390 x 844 |
| Tablet | 768 x 1024 |
| Small desktop | 1024 x 768 |
| Reference desktop | 1248 x 1085 |
| Wide desktop | 1440 x 1000 |

For each viewport verify:

- No horizontal page scroll.
- Global nav remains one line on desktop.
- Hero CTA is visible in the first viewport.
- Product grids switch at the specified breakpoints.
- Text does not clip, overlap, or wrap unexpectedly.
- Buttons do not wrap labels.
- Focus indicators are visible and not clipped.
- Registration marks align to frame corners.
- Border color is visible without dominating content.
- No doubled borders inside shared frames.
- Mono labels/numbers use the correct font.
- Light and dark theme hierarchy match.
- Loading, empty, error, success, and disabled states are captured.
- Long names, long project names, large numbers, and translated-length strings
  do not break the layout.

## 24. Final preflight checklist

### Visual identity

- [ ] Canonical dark theme matches the near-black, hairline, high-density
  reference language.
- [ ] Public pages use the framed central rail.
- [ ] Product overview uses the wide three-column frame system.
- [ ] Violet is the only general brand accent.
- [ ] Semantic colors are used only for real states/data.
- [ ] Radius rules are consistent.
- [ ] No generic floating shadcn card stack remains.
- [ ] No copied Command Code assets or copy exist.

### Typography and content

- [ ] Geist Sans and Geist Mono are self-hosted and load without layout shift.
- [ ] Product titles/metrics use mono; marketing headlines use sans.
- [ ] Uppercase/`//` labels are restrained.
- [ ] No fake data, customers, prices, or claims appear.
- [ ] Every visible string has been proofread.

### Layout

- [ ] Hero fits the initial viewport.
- [ ] Public rail is max 1120px and uses correct section padding.
- [ ] Dashboard uses 28-40px desktop gutters and 12px grid gaps.
- [ ] Shared frames do not show doubled borders.
- [ ] Mobile collapse is explicit for every multi-column component.

### Interaction and state

- [ ] Hover, active, focus, disabled, and busy states exist.
- [ ] Loading, empty, error, success, and offline states exist.
- [ ] Motion uses only transform/opacity and respects reduced motion.
- [ ] Realtime state is textually identifiable.
- [ ] Copy actions announce success.

### Accessibility and performance

- [ ] WCAG AA contrast passes in both themes.
- [ ] Keyboard navigation and focus restoration pass.
- [ ] Screen-reader labels and live regions are appropriate.
- [ ] Charts/maps have text alternatives.
- [ ] LCP is below 2.5s, CLS below 0.1, and INP below 200ms in the production
  build.
- [ ] Fonts, screenshots, and critical assets are locally served/optimized.

### Hosted and self-hosted behavior

- [ ] Hosted signup path is clear.
- [ ] Self-host path is equally discoverable but does not compete as a second
  primary CTA.
- [ ] Self-hosted auth names the local instance.
- [ ] No Prism cloud account or outbound service is silently required.
- [ ] Missing optional integrations degrade gracefully.

