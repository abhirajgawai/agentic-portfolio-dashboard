---
name: ui-designer
description: The ui-designer agent's procedure — audit the current dashboard, produce 3 design directions for the user to pick, then write the spec package (spec.md, tokens.json, rationale, motion, a11y) under docs/design/ for the dashboard-builder to implement. Use when planning or delegating dashboard revamp / redesign / UX work.
---

# Skill: UI/UX Designer (Portfolio Dashboard)

This skill provides the procedures, templates, and standards for the `ui-designer` agent to produce design specifications for the portfolio dashboard revamp.

## When to Use This Skill

- **M8.5+**: Any dashboard redesign, new screen, or significant UX improvement
- **New feature design**: When a new data visualization or interaction pattern is needed
- **Design system evolution**: Updating tokens, components, or motion language
- **Accessibility audit**: Ensuring WCAG AA compliance across the dashboard

## Design Process (Orchestrator-Aligned)

### Phase 1: Discovery & Analysis (Mandatory First Step)
```
1. Read contract.ts → verify immutable JSON shapes
2. Read index.css → extract current tokens (OKLCH values)
3. Read latest.json/history.json/alerts.json/xirr.json → real data fixtures
4. Audit current components → component inventory + state coverage
5. Document findings in design audit report
```

### Phase 2: Design Exploration (3 Directions)
For each direction, produce a **Direction Document**:
```
docs/design/YYYY-MM-DD-<scope>-direction-{1,2,3}.md
```

Each direction must contain:
| Section | Required Content |
|---|---|
| Concept | 1-paragraph philosophy + 3-word tagline |
| Mood Board | 3-5 references (Linear, Vercel, Stripe, Notion, GitHub) with specific annotations |
| Token Diff | `index.css` diff: current → proposed (OKLCH, spacing, radii, shadows, motion) |
| Component Anatomy Table | Current component → proposed variants/states/slots/props |
| Screen Wireframes | ASCII/mermaid per screen with interaction callouts (hover, click, drill) |
| Motion Specs | Entrance, data refresh, hover, drill-down, cross-filter (duration, easing, stagger) |
| Trade-offs | Honest: density vs. clarity, novice vs. expert, performance vs. delight |
| Effort Estimate | S/M/L per screen + new components |

### Phase 3: Selection & Specification
User selects direction (or hybrid) → you produce **Complete Spec Package**:
```
docs/design/spec/
├── tokens.json                    # Machine-readable tokens (CSS vars + TS types)
├── components/
│   ├── holding-card.spec.md
│   ├── allocation-donut.spec.md
│   ├── trend-chart.spec.md
│   ├── returns-bars.spec.md
│   ├── xirr-card.spec.md
│   ├── alert-card.spec.md
│   ├── chat-message.spec.md
│   ├── layout-shell.spec.md
│   ├── data-table.spec.md
│   ├── filter-bar.spec.md
│   ├── stat-card.spec.md
│   └── empty-state.spec.md
├── screens/
│   ├── overview.spec.md
│   ├── holdings-india.spec.md
│   ├── holdings-us.spec.md
│   ├── returns.spec.md
│   ├── alerts.spec.md
│   └── chat.spec.md
├── motion/
│   ├── entrance.anim.md
│   ├── data-refresh.anim.md
│   ├── hover-focus.anim.md
│   ├── drill-down.anim.md
│   └── cross-filter.anim.md
├── accessibility/
│   ├── a11y-checklist.md
│   └── focus-order.md
├── responsive/
│   └── breakpoints.md
└── rationale.md
```

### Phase 4: Handoff & Review
- **Hand off** to `dashboard-builder` via orchestrator
- **Review PRs** for design fidelity (visual, tokens, motion, a11y)
- **Iterate** on gaps (max 2 rounds before escalation)

## Design Token System

### Current Token Structure (Reference)
```css
/* From dashboard/src/index.css */
:root {
  --radius: 0.625rem;
  --background: oklch(0.13 0.006 285);
  --foreground: oklch(0.97 0.004 285);
  --card: oklch(0.165 0.007 285);
  --primary: oklch(0.68 0.16 262);
  --gain: oklch(0.72 0.15 155);
  --loss: oklch(0.63 0.2 25);
  --warning: oklch(0.8 0.14 85);
  /* ...chart palette --chart-1 through --chart-5 */
}
@theme inline { /* maps to Tailwind utilities */ }
```

### Extended Token Categories (For Redesign)
```json
{
  "color": { "background", "foreground", "card", "border", "primary", "gain", "loss", "warning", "chart", "overlay", "focus" },
  "spacing": { "base": 12, "scale": [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] },
  "radius": { "none": 0, "sm": 4, "md": 8, "lg": 12, "xl": 16, "full": 9999 },
  "shadow": { "xs", "sm", "md", "lg", "xl", "inner", "focus" },
  "typography": { "fontFamilies", "fontSizes", "fontWeights", "lineHeights", "letterSpacings" },
  "motion": { "durations", "easings", "stagger", "reducedMotion" },
  "breakpoints": { "mobile": 640, "tablet": 1024, "desktop": 1280 },
  "density": { "comfortable": 12, "compact": 8 },
  "zIndex": { "dropdown": 100, "sticky": 200, "modal": 300, "popover": 400, "toast": 500 }
}
```

## Component Spec Template

Every component spec follows this structure:

```markdown
# Component: <Name>

## Purpose
One sentence: what this component does and where it lives.

## Anatomy (Slots)
| Slot | Required | Description |
|---|---|---|
| root | yes | Container, applies density, variant |
| header | no | Title, subtitle, actions |
| content | yes | Main data display |
| footer | no | Pagination, summary, actions |

## Variants
| Variant | Use Case | Visual Difference |
|---|---|---|
| default | Standard | Base styling |
| compact | Dense tables | Reduced padding, smaller text |
| featured | Hero stat | Larger, elevated, accent border |

## States
| State | Trigger | Visual | Motion |
|---|---|---|---|
| default | - | Base | - |
| hover | Mouse enter | Elevate + border | 150ms ease-out |
| focus | Keyboard | Ring (--focus) | Instant |
| loading | Data fetch | Skeleton pulse | 1.5s infinite |
| empty | No data | Illustration + CTA | Fade in 300ms |
| error | Fetch fail | Destructive banner | Shake 200ms |
| stale | Data > threshold | Warning badge | Pulse 2s |
| masked | Privacy toggle | MASK_TEXT | Cross-fade 200ms |

## Props (TypeScript Interface)
```ts
interface ComponentProps {
  variant?: 'default' | 'compact' | 'featured';
  density?: 'comfortable' | 'compact';
  // data props from contract.ts
  // event handlers
}
```

## Accessibility
- ARIA role/label requirements
- Focus order (tab sequence)
- Screen reader announcements for live regions
- Color contrast ratios (WCAG AA: 4.5:1 text, 3:1 UI)

## Motion Spec
- Entrance: stagger 80ms, slide-up 200ms ease-out
- Data update: counter 400ms, chart morph 500ms
- Reduced motion: instant, no stagger

## Implementation Notes
- shadcn/ui primitives to compose from
- ECharts option builder changes
- TanStack Table column definitions
- Zod schema for props validation
```

## Motion Specification Template

```markdown
# Motion: <Name>

## Trigger
What initiates this animation (mount, prop change, user action, data refresh).

## Keyframes
| Progress | Transform | Opacity | Other |
|---|---|---|---|
| 0% | translateY(8px) | 0 | filter: blur(4px) |
| 60% | translateY(-2px) | 1 | - |
| 100% | translateY(0) | 1 | - |

## Timing
- Duration: 400ms
- Easing: cubic-bezier(0.16, 1, 0.3, 1) — "ease-out-expo"
- Stagger: 80ms per item (max 300ms total)

## Reduced Motion
- Duration: 0ms (instant)
- No stagger
- Opacity only (no transform)

## Performance
- GPU-accelerated properties only (transform, opacity)
- Will-change hint during animation
- Layout shift: none (reserved space)

## Implementation
- CSS keyframes + Tailwind `animate-*` utilities (NO Framer Motion — bundle budget)
- ECharts built-in animation for charts (configure via option)
```

## Screen Spec Template

```markdown
# Screen: <Name> (e.g., Overview, Holdings India, Returns)

## Route / Tab
`/overview` or tab ID from AppShell

## Data Requirements (from contract.ts)
- `Latest` — totals, allocation, platforms, holdings[]
- `History` — dates, portfolioValueBase, byGeography, byPlatform
- `Alerts` — generatedAt, alerts[]
- `Xirr` — asOf, perAccount

## Layout Structure
```
Header (fixed)
├── Brand + Tabs
├── StatusBar (live)
└── Actions (Refresh, Chat, Privacy)

Main (scrollable)
├── Section: Executive Summary (StatCards)
├── Section: Allocation (4 Donuts)
├── Section: Trend (Area Chart)
├── Section: Holdings Preview (Top 5 + "View All")
└── Section: Alerts Summary (Count + "View All")
```

## Responsive Behavior
| Breakpoint | Layout Change |
|---|---|
| ≤640 (mobile) | Single column, tabs scroll, cards stack, tables → cards |
| 641-1024 (tablet) | 2-col donuts, condensed stat cards, table horizontal scroll |
| >1024 (desktop) | 4-col donuts, full stat cards, sticky table header |

## Interaction Map
| User Action | Component | Response | Navigation |
|---|---|---|---|
| Click holding row | HoldingsTable | Drill-down modal | Push state |
| Click donut slice | AllocationDonut | Filter holdings | Update URL filter |
| Click geography pill | FilterBar | Cross-filter all | Update URL |
| Click "Refresh" | RefreshButton | Spin → toast → refetch | - |
| Toggle privacy | PrivacyToggle | Cross-fade values | - |

## States
| Screen State | Condition | Rendering |
|---|---|---|
| Loading | Any query loading | Skeleton cards + chart placeholders |
| Error | Any query error | ErrorState with retry |
| Empty | No holdings | EmptyState with CTA to run pipeline |
| Partial | Some queries failed | Show available, banner for failed |
| Stale | Platform stale=true | Warning banner + per-platform badges |

## Accessibility
- Heading hierarchy (h1 → h2 → h3)
- Live region for data refresh announcements
- Skip link to main content
- Keyboard shortcuts (R=refresh, /=search, ?=help)
```

## Design Review Checklist (Pre-Handoff)

Before handing off to `dashboard-builder`, verify:

### Contract Compliance
- [ ] Every field in `contract.ts` has a designated component/slot
- [ ] No new fields proposed without orchestrator approval
- [ ] Nullable fields have explicit "—" / empty state handling

### Token Completeness
- [ ] No hardcoded colors/spacing/radii in component specs
- [ ] All tokens reference CSS custom properties
- [ ] Dark-only (no light theme tokens)

### State Coverage
- [ ] Loading, empty, error, partial, masked, stale — all specified per component
- [ ] Focus states for every interactive element
- [ ] Disabled states for actions

### Motion Budget
- [ ] Total entrance animation < 800ms (staggered)
- [ ] Data refresh < 600ms (counter + chart morph)
- [ ] Interaction feedback < 150ms
- [ ] Reduced motion: all instant, no layout shift

### Accessibility Baseline
- [ ] WCAG AA contrast (4.5:1 text, 3:1 UI) — verify with OKLCH
- [ ] Focus visible on all interactive elements
- [ ] ARIA labels for icon-only buttons
- [ ] Live regions for dynamic updates
- [ ] Heading hierarchy correct

### Responsive
- [ ] Mobile (≤640), Tablet (641-1024), Desktop (>1024) all specified
- [ ] Touch targets ≥ 44×44px on mobile
- [ ] Table horizontal scroll on mobile with sticky first column

### Performance
- [ ] No new heavy dependencies (bundle +50KB max)
- [ ] ECharts tree-shaking preserved (modular imports)
- [ ] Images: none (icon font only)
- [ ] Fonts: system UI stack (no web fonts)

### Guardrails
- [ ] Determinism boundary respected (chat only non-deterministic)
- [ ] shadcn/ui primitives only (no custom Radix)
- [ ] Tailwind v4 CSS variables (no tailwind.config.js)
- [ ] Stack locked (React 19, TS strict, Vite 8)

## File Organization

```
docs/design/
├── audit/
│   └── YYYY-MM-DD-design-audit.md
├── directions/
│   ├── YYYY-MM-DD-<scope>-direction-1.md
│   ├── YYYY-MM-DD-<scope>-direction-2.md
│   └── YYYY-MM-DD-<scope>-direction-3.md
├── selected/
│   └── YYYY-MM-DD-<scope>-selected-direction.md
└── spec/                    # Complete handoff package
    ├── tokens.json
    ├── components/
    ├── screens/
    ├── motion/
    ├── accessibility/
    ├── responsive/
    └── rationale.md
```

## Collaboration Commands

### For the Orchestrator
```bash
# Delegate design exploration
task --subagent ui-designer --prompt "Produce 3 design directions for dashboard revamp per skill"

# Delegate spec production (after user selects direction)
task --subagent ui-designer --prompt "Produce complete spec package for selected direction: <direction-name>"

# Delegate design review of PR
task --subagent ui-designer --prompt "Review PR #123 for design fidelity against spec"
```

### For the Dashboard-Builder (Receiving Handoff)
```bash
# Read the spec package
cat docs/design/spec/tokens.json
cat docs/design/spec/components/holding-card.spec.md
# ... implement per spec
```

## Quality Gates

### Direction Documents
- [ ] All 8 required sections present
- [ ] Token diff is valid CSS (OKLCH values)
- [ ] Component table covers all current components
- [ ] Wireframes include interaction callouts
- [ ] Motion specs have durations + easings
- [ ] Trade-offs are honest and specific
- [ ] Effort estimates are S/M/L per screen

### Spec Package
- [ ] `tokens.json` validates against schema
- [ ] Every component has anatomy, variants, states, props, a11y, motion
- [ ] Every screen has layout, responsive, interactions, states, a11y
- [ ] Motion specs cover entrance, refresh, hover, drill, cross-filter
- [ ] Accessibility checklist complete
- [ ] Responsive breakpoints documented
- [ ] Rationale.md links decisions to data/user needs

## References

### Current System Files
- `dashboard/src/types/contract.ts` — JSON contract (immutable)
- `dashboard/src/index.css` — Current tokens (OKLCH, dark-only)
- `dashboard/components.json` — shadcn/ui v4 config
- `dashboard/src/components/charts/options.ts` — ECharts builders
- `dashboard/public/data/*.json` — Real data fixtures

### Design Inspiration (Study These)
- **Linear.app** — Command palette, density toggle, motion language
- **Vercel Dashboard** — Dark theme, stat cards, progressive disclosure
- **Stripe Dashboard** — Financial data tables, color semantics, density
- **Notion** — Empty states, inline actions, calm typography
- **GitHub** — Data density, filtering, keyboard shortcuts
- **Figma** — Collaborative cursors, multiplayer hints (future chat)

### Technical References
- Tailwind v4: https://tailwindcss.com/docs
- shadcn/ui v4: https://ui.shadcn.com/docs
- ECharts 6: https://echarts.apache.org/en/option.html
- TanStack Table v8: https://tanstack.com/table/v8
- CSS motion (no Framer Motion — bundle budget): https://developer.mozilla.org/en-US/docs/Web/CSS/animation
- WCAG AA: https://www.w3.org/WAI/WCAG21/quickref/