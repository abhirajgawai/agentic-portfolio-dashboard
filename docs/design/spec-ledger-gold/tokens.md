# Ledger Gold — Token Mapping (light mode)

Companion to `docs/superpowers/specs/2026-09-12-ledger-gold-redesign-design.md` §2.
All values below are the **existing** `:root` tokens in `dashboard/src/index.css` —
this redesign reuses them, it does not replace them. Listed here so every
implementation task can cite exact `var(--token)` names instead of hex codes.

| Use | Token | Current value | Approx hex |
|---|---|---|---|
| Page background | `--background` | `oklch(0.985 0.008 75)` | `#FBFAF7` |
| Card surface | `--card` | `oklch(1 0 0)` | `#FFFFFF` |
| Body text | `--foreground` | `oklch(0.22 0.018 58)` | `#2E2620` |
| Secondary text | `--muted-foreground` | `oklch(0.48 0.02 60)` | `#8A8073` |
| Accent / brand | `--primary` | `oklch(0.56 0.135 65)` | `#B8823D` |
| Accent on-fill text | `--primary-foreground` | `oklch(0.99 0.006 70)` | `#FDFCF9` |
| Borders / dividers | `--border` | `oklch(0.9 0.014 70)` | `#EAE3D6` |
| Sunken surfaces (pill nav track, table stripe) | `--muted` | `oklch(0.96 0.008 72)` | `#F4F0E8` |
| Positive delta | `--gain` | `oklch(0.52 0.14 155)` | `#2F8F5B` |
| Negative delta | `--loss` | `oklch(0.55 0.19 25)` | `#C1432A` |
| Warning / stale-data | `--warning` | `oklch(0.62 0.15 85)` | `#B98A1E` |
| Card shadow (default) | `--shadow-md` | see `index.css:66` | — |
| Card shadow (elevated / hero chart) | `--shadow-lg` | see `index.css:67` | — |
| Radius (cards) | `--radius-lg` | `var(--radius)` = `0.625rem` | — |
| Radius (pills, chips) | full pill | `border-radius: 999px` (utility, not a token) | — |
| Hero numeral typeface | `.font-headline` class | Fraunces, defined `index.css:271` | — |
| Body typeface | default | system sans stack, `index.css:251` | — |

## Known gap — flag during implementation

`--chart-1` through `--chart-9` are the **categorical** palette (used to color
different platforms/instruments distinctly in tables, donuts, legends) — `--chart-1`
today resolves to a blue-purple (`oklch(0.55 0.18 262)`), NOT gold. The Journey
chart's line/area (a single-series trend, not a categorical series) should NOT use
`--chart-1` for that reason, even though the pre-redesign code may currently do so.

**Resolution for this pass:** add one new token, `--chart-journey`, aliased to
`var(--primary)` in both `:root` and `.dark` (`.dark`'s definition can be a straight
alias for now — dark mode itself is out of scope, but the token must exist so the
same component code doesn't need a themed branch later). Add it to `index.css`'s
`:root` block near the other chart tokens and to the `@theme inline` block as
`--color-chart-journey: var(--chart-journey);` so `text-chart-journey` /
`stroke-[var(--color-chart-journey)]` utilities work. This is the one token addition
this redesign makes — everything else reuses existing tokens unchanged.

## Explicitly not touched this pass

`--chart-1`..`--chart-9` (categorical palette, used elsewhere for platform/instrument
coloring — Allocation's donuts and Portfolio's platform dots should keep using these
as today, restyled only via the components that consume them, not by changing the
palette itself) and the entire `.dark {}` block (§1 of the design brief — dark mode
fast-follow).
