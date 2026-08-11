# Prism logo usage

The canonical Prism mark is a two-piece folded-prism silhouette: an
off-white upper facet and a violet lower facet separated by one narrow
diagonal channel. The mark always renders on a **perfectly square** canvas.

## Canonical files

| Asset | Path | Status |
| --- | --- | --- |
| Master mark (dark) | `packages/brand/assets/prism-mark.svg` | **source** |
| Mark variants | `packages/brand/assets/prism-mark-{light,monochrome,black,white,violet}.svg` | **source** |
| Lockup template | `packages/brand/assets/prism-lockup.svg` | source (font embedded at export) |
| Raster exports | `packages/brand/generated/` | **generated** — never hand-edit |
| Consumer copies | `apps/web/public/*`, `apps/docs/public/favicon.svg`, `apps/api/src/auth/email-logo.ts`, `packages/email-templates/emails/logo-png.ts` | generated + drift-checked |

The direction reference `packages/brand/references/prism-mark-final-reference.png`
is generation residue, not a production asset.

## Regenerating exports

```sh
yarn workspace @prism/brand run export   # regenerate + copy to consumers
yarn workspace @prism/brand run check    # fail if committed copies drifted
```

## Using the mark

- **Product UI**: use the `PrismMark` / `PrismLogo` components
  (`apps/web/src/components/brand/`). The mark is always square; the
  lockup composes the unchanged square mark with the PRISM wordmark.
- **Standalone mark in a link**: the link needs an accessible name
  (`Prism home`); the SVG itself is decorative (`aria-hidden`).
- **Mark next to visible text**: make the SVG decorative.
- **Minimum sizes**: 16px standalone; 20–24px in navigation.
- **Clear space**: keep at least the diagonal channel's optical thickness
  (~1.3/24 of the mark height) free on all sides.

## Variants

| Variant | Use |
| --- | --- |
| `dark` | Dark surfaces (`#F2F2F4` upper, `#6547E8` lower) |
| `light` | Light surfaces (`#111116` upper, `#6547E8` lower) |
| `monochrome` | UI that inherits `currentColor` |
| `violet` | Neutral surfaces that need one color (README, docs) |
| `black` / `white` | Print, email fallbacks, constrained integrations |

## Prohibited treatments

Stretching or rotating the mark; recoloring facets with semantic status
colors; adding a container or background shape; changing facet angles;
closing or removing the diagonal gap; adding beams, spectrum rays, or
gradients; duplicating the facets; using the mark as a play button, chart,
or generic navigation icon.

## License

The Prism mark is part of the Prism distribution and is governed by the
repository license. Downstream self-hosters may use it with Prism
distributions; it is not a standalone licensed asset.
