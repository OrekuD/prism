# Nested Sheet Presentation — Goals & Experience Spec

> **Status:** Draft — experience/goal spec, not an implementation plan.  
> **Date:** 2026-09-01  
> **Context:** `IssueDetail` (`/errors/:issueId`) already presents as a right-drawer `Sheet` over the `Errors` list. `Recent occurrences` will open per-occurrence detail as a *second* sheet over the first. This spec generalizes that to **n-deep** presentation that feels like iOS presentation modals, but mounted from the **right**.

---

## 1. Problem

Today a `Sheet` is a single modal over a page. Nesting two `Sheet`s (issue → occurrence) works functionally — two `Dialog` portals with two `Overlay`s — but feels like two independent modals stacked at `z-50`. There is no sense of depth, no relationship between the sheets, and no system for going deeper than 2. We want a *presentation stack* where each new sheet is clearly *on top of* the previous one, with a tactile, spatial relationship.

Sentry and similar tools show an issue list → issue detail → event detail as a drill-down. We want that drill-down to feel physical on the web, even though our sheets come from the **right** (drawer), not the bottom.

## 2. Goals

### 2.1. Right-mounted presentation

* Every sheet in the stack **mounts from the right** (`translateX: 100% → 0%`) with a spring. It is a drawer, not a bottom sheet.
* The sheet underneath does **not** disappear — it stays visible, peeking from behind the new sheet’s left edge, so the user never loses the sense of “where I came from.”

### 2.2. Depth through scale, not just overlay

* When a child sheet mounts, the **immediate parent scales down a bit** with a slight `x` offset to the left and a dim. All sheets retain square corners at every depth. The dim is *between* the two sheets, not over the whole page.
* If three sheets are visible, they form a **stair**:  
  `depth 0 (top): scale 1.00, x 0, dim 0`  
  `depth 1: scale 0.97, x -12px, dim 0.12`  
  `depth 2: scale 0.94, x -24px, dim 0.20`  
  `depth 3: scale 0.91, x -36px, dim 0.28`  
  Exact numbers are subject to tuning, but the *principle* is: each step is subtle, cumulative, and consistent.
* The effect is **purely visual** — the parent sheet is inert (no scroll, no clicks) while a child is open, but its content remains readable behind the dim so the user understands the stack.

### 2.3. Backdrop dismisses only the top sheet

* Clicking the **child’s backdrop** dismisses *only* the child, revealing the parent underneath at its scaled state, which then springs back to `scale 1.00`.  
* Clicking the parent’s backdrop while a child is open does nothing — the child’s overlay is on top and captures the click.
* `Esc` behaves the same: one press = one level popped.

### 2.4. Generic depth, with a 3-visible window

* The stack is **generic to n**. A user could drill `issue → occurrence → occurrence → …` (or in the future `issue → occurrence → related event → …`) arbitrarily deep.
* For performance and visual clarity, **only the top 3 sheets are mounted in the DOM at any time**.
* If a 4th sheet is pushed (`[A, B, C] → [A, B, C, D]`), the **bottom sheet (`A`) unmounts from the DOM** but its *route and data* stay in history/cache. Visually the stack becomes `[B, C, D]` with `B` now at the deepest visible scale.
* **Going back is smart:** popping `D` (`[B, C, D] → [B, C]`) causes `A` to **remount** behind `B` (at the deepest scale) so the stack becomes `[A, B, `C`]` again. In other words, the visible window is always `history.slice(-3)` — we never lose history, we just window the rendering.
* Direct deep link (`/errors/:issueId/occurrences/:a/occurrences/:b/occurrences/c/occurrences/d/occurrences/e` — depth 5) still only mounts the last 3 (`c,d,e`), but pressing back walks `e → d → c → b → a` and each step brings the next older sheet back into view.

### 2.5. URL is the stack

* The stack *is* the URL. `…/errors/:issueId` = 1 sheet, `…/errors/:issueId/occurrences/:occId` = 2 sheets, `…/occurrences/:occId/occurrences/:nextId` = 3, etc.
* Browser back/forward, `Copy link`, and refresh all restore the same stack depth. No in-memory-only stack that diverges from the URL.
* Refresh at depth 4 mounts the last 3 sheets immediately, with their data re-fetched from cache/network.

### 2.6. Feel — iOS, but for a right drawer

* **Spring, not tween:** mount/dismiss and parent scale/translate use a restrained spring (`stiffness ~300, damping ~28`) so it feels physical without a pronounced bounce.
* **No layout shift in the underlying page:** the `Errors` list behind the first sheet does not reflow; only the sheets themselves transform.
* **Focus follows the top sheet:** when a child mounts, focus moves into it; when it dismisses, focus returns to the parent sheet’s trigger (the `Recent occurrences` card that was clicked).
* **Scroll is owned by the top sheet only:** the sheet behind does not scroll while a child is open.

## 3. Non-Goals

* Not a bottom sheet — the direction is fixed to **right** for this surface. A bottom variant can be added later but is out of scope.
* Not a full window manager (drag to reorder, minimize, etc.).
* Not a design for more than 3 *visible* sheets at once — 3 is the visual cap; deeper history is virtualized, not rendered.

## 4. User Experience — What It Should Feel Like

1.  User clicks a `Recent occurrences` card in the `IssueDetail` sheet. The issue sheet **shrinks back** a touch and dims, and the occurrence sheet **slides in from the right** over it. The issue’s title and `StatusTag` are still visible peeking from the left, so the user knows they can go back.
2.  User clicks the occurrence sheet’s backdrop (the dimmed strip of the issue sheet) — the occurrence sheet **slides back to the right** and the issue sheet **springs forward** to full size. The list underneath never moved.
3.  User drills again from inside the occurrence sheet (future: `Related event` link) — now three sheets are visible as a stair, each peeking from behind the next. The bottom one is the original issue, slightly smaller than the middle one.
4.  User drills a fourth time — the original issue sheet **fades out of the DOM** (no animation, just unmount), the stack now shows the three most recent. From the user’s perspective, it still feels like “I’ve gone 4 deep,” but the oldest is just out of view.
5.  User presses `Back` — the top sheet slides away, and the previously-unmounted sheet **remounts** behind the stack with a subtle scale-in, so the stair is complete again.

## 5. Stack Visibility Rule

* **Visible set = `history.slice(-3)`** where `history` is the ordered list of sheet routes in the navigation stack (derived from the URL).
* **Mount/unmount is visual only** — data for unmounted sheets stays in `queryCache`/`persistQueryClient` so remount is instant and does not refetch.
* No sheet is ever “destroyed” in history — only un-rendered. The router’s history is the source of truth.

## 6. Routing Contract

* `IssueDetail` is at `workspace/:wrkSlug/projects/:slug/errors/:issueId`
* `OccurrenceDetail` is at `workspace/:wrkSlug/projects/:slug/errors/:issueId/occurrences/:occurrenceId`
* Deeper levels reuse the same pattern: `…/occurrences/:occurrenceId` can be nested recursively. The router will be configured as a **recursive `*` or nested `occurrences/:id` route** so depth is unbounded, but the spec only requires the first level to ship.
* Each sheet’s `open` is `true` when its route matches; `onOpenChange(false)` does `navigate("..")` (pop one level), never `navigate(-1)` with a delta, so the stack stays URL-driven.

## 7. Accessibility & Polish

* `Esc` closes one level, `Shift+Esc` is not required.
* Backdrop has `aria-hidden` and is not tabbable; focus is trapped in the top sheet only.
* Reduced motion: if `prefers-reduced-motion`, disable scale/parallax and use a simple `translateX` with `duration 150ms`.
* The handle/capsule affordance is not needed for a right drawer, but the left edge of the child sheet should have a visible `border` + `shadow` to separate it from the dimmed parent.

## 8. Success Criteria

* User can open `issue → occurrence` and see the parent issue sheet scaled/dimmed behind the occurrence sheet, clearly indicating depth.
* Clicking the child’s backdrop or pressing `Esc` returns to the issue sheet without a full page reload or list refetch.
* Opening 4+ levels never renders more than 3 sheets in the DOM (inspect → 3 `SheetContent` nodes), but pressing back 4 times walks back through all 4 levels with correct data.
* Refresh at any depth restores the same visual stack and the same data, with no flash of the list.
