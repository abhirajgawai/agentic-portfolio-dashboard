# Journey Redesign ("Ascent") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Journey workspace's hero chart (`JourneyChart.tsx`) on `@visx` with path-morphing range transitions, a shared SVG glow, spring-driven number counters and milestone pops, a sparse/dense rendering split, and a `motion`-driven entrance stagger — replacing the dated, Brush-broken Recharts plot per the user's explicit "complete redesign, not an update" request.

**Architecture:** The chart's Recharts plot (`ComposedChart`/`Area`/`Line`/`Brush`/`XAxis`/`YAxis`) is replaced by hand-composed SVG driven by `@visx/scale` scales and `@visx/shape` primitives, with `d3-interpolate-path` tweening the `d` attribute on range changes. `motion`'s core `animate`/spring API drives number counters and milestone pops; `motion/react`'s `<motion.div>` drives the workspace entrance stagger. Everything else in the app (ECharts, other Recharts usage, the contract, the bridge) is untouched.

**Tech Stack:** React 19.2 + TS strict, Tailwind v4, shadcn/ui New York, `@visx/shape` `^4.0.0`, `@visx/scale` `^4.0.0`, `@visx/gradient` `^4.0.0`, `d3-interpolate-path` `^2.3.0`, `motion` `^13.1.1`.

**Spec:** `docs/design/spec-round3/spec.md` (primary — every task below cites exact section numbers; read the cited section before implementing it, this plan does not re-paste the spec's code). Companion docs, all in `docs/design/spec-round3/`: `rationale.md` (why non-obvious calls were made), `accessibility/a11y-spec.md` (the authoritative 8-row reduced-motion table), `motion/motion-spec.md` (animation timing/character per interaction). Selection context: `docs/design/selected/2026-08-27-journey-redesign-selected-direction.md`. Audit (root causes, numbered, referenced as "audit §N" below): `docs/design/audit/2026-08-27-journey-redesign-audit.md`.

## Global Constraints

- `dashboard/src/types/contract.ts` is **IMMUTABLE** — this plan reads only `History.dates`, `.portfolioValueBase`, `.byGeography`, `.byPlatform`, and `goals` via the existing `useGoalsData()` — all already exported today. No contract or `export_json.py` change anywhere in this plan.
- Scope is **the Journey workspace only** (`dashboard/src/components/journey/`) — no other workspace, no `dashboard/src/lib/charts.ts` (ECharts), no other screen's Recharts usage changes.
- Every color is an existing CSS custom property from `dashboard/src/index.css` — **zero new tokens** (confirmed exhaustively in `docs/design/spec-round3/tokens.json`). Reference tokens as `var(--token-name)` exactly as the current file already does.
- Both light and dark themes are first-class — verify every visual task in both.
- `usePrivacy()`/`MASK_TEXT` (`dashboard/src/lib/privacy.tsx`, `dashboard/src/lib/format.ts`) gates every money value the new chart draws — axis ticks, point labels, tooltip, delta chips, milestone inline labels. Percentages/dates/counts stay visible when masked.
- `prefers-reduced-motion: reduce` (`usePrefersReducedMotion()` from `./motion`) independently gates all 8 new-motion interactions — see `accessibility/a11y-spec.md` §6 for the authoritative per-interaction table. Never collapse this into one top-level flag.
- `motion` import discipline (bundle-size critical): `useMotionValue`/`useSpring`/`animate` come from `"motion"` (the ~5-6KB core), NOT `"motion/react"`, **except** `JourneyWorkspace.tsx`'s entrance stagger and `GoalMilestones.tsx`'s crossing pop, which need `motion/react`'s `<motion.div>`/`<motion.span>` component API (~18-20KB) — this is spec §8/rationale.md §7's explicitly-flagged, not-silently-absorbed cost. Do not import `motion/react` anywhere else.
- `curveLinear` (from `@visx/curve`) is required for the line/area, never a smoothed curve — carried-forward snapshot values must never imply interpolated data (rationale.md §2).
- Run `npm run typecheck && npm run lint` (from `dashboard/`) after every task before committing. Nothing in this plan touches contract-read shapes, so `check:contract` is unaffected, but run it once at the end (Task 9) to confirm.

---

## ⚠️ Resolved spec conflict (read before Task 2)

Spec §3.2 says `<ChartContainer>` "is also removed — it's a Recharts-context provider and has nothing to provide once the plot isn't Recharts." **This is incorrect and would break Task 4's tooltip reuse if followed literally.** Verified by reading `dashboard/src/components/ui/chart.tsx`: `ChartContainer` is a **plain `<div>` + a vanilla React `Context.Provider`** (`ChartContext.Provider value={{ config }}`) — it renders no Recharts component at all. `ChartTooltipContent` (which spec §3.8 explicitly says to keep reusing) calls `useChartConfig()`, which **throws** (`"useChartConfig must be used within a ChartContainer"`) if no `<ChartContainer>` ancestor exists.

**Ruling:** keep a `<ChartContainer config={chartConfig}>` wrapper around the new SVG markup in `JourneyChart.tsx`. It contributes zero Recharts dependency (confirmed by reading its source) — it exists solely to satisfy `ChartTooltipContent`'s config-context requirement. Everything else spec §3.2 says to remove (`ComposedChart`, `Area`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Brush`, `ReferenceLine`, `ResponsiveContainer`, `LabelList`) is still removed exactly as written. Task 2 below reflects this ruling.

---

### Task 1: Install dependencies + verify `motion` API surface

**Files:**
- Modify: `dashboard/package.json`, `dashboard/package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: confirmation that `useMotionValue`, `useSpring`, and `.on("change", cb)` exist on the installed `motion@13.1.1` package's type definitions (or the corrected real API names, if different) — Task 6 consumes whichever names this task confirms.

- [ ] **Step 1: Install the exact versions from spec.md §2**

```bash
cd dashboard
npm install @visx/shape@^4.0.0 @visx/scale@^4.0.0 @visx/gradient@^4.0.0 d3-interpolate-path@^2.3.0 motion@^13.1.1
npm install -D @types/d3-interpolate-path@^2.0.3
```

- [ ] **Step 2: Confirm the real `motion` hook API against installed typings**

Spec §7 flags this explicitly as unverified. Run:

```bash
grep -rn "useMotionValue\|useSpring" node_modules/motion/dist/*.d.ts node_modules/motion/dist/**/*.d.ts 2>/dev/null | head -20
```

If `useMotionValue`/`useSpring` aren't there under those exact names, check `node_modules/motion/package.json`'s `"exports"` field for the core entry point's actual `.d.ts` path and grep that file instead. Note the confirmed (or corrected) import path and hook names in your task report — Task 6 needs this exact information.

- [ ] **Step 3: Confirm peer-dependency compatibility**

```bash
npm ls @visx/shape @visx/scale @visx/gradient motion d3-interpolate-path
```

Expected: no `UNMET PEER DEPENDENCY` warnings against React 19.2.8.

- [ ] **Step 4: Typecheck (should still pass — nothing consumes the new deps yet)**

```bash
npm run typecheck
```

Expected: PASS, unchanged from before this task.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(dashboard): add visx/d3-interpolate-path/motion for Journey chart redesign"
```

---

### Task 2: `JourneyChart.tsx` — static visx plot rebuild (no morph/glow/pulse yet)

**Files:**
- Modify: `dashboard/src/components/journey/JourneyChart.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 directly (just the installed packages).
- Produces: `useElementWidth(ref)` — a new local hook in this file, `(ref: RefObject<HTMLElement | null>) => number`, returning the observed content-box width in px via `ResizeObserver` (same pattern as `useInView`, spec §3.3). Task 3 and Task 4 both call the `xScale`/`yScale` this task builds from it. The file's exported `JourneyChart` component signature is unchanged (`{ history }: { history: History }`).

Implement per **spec.md §3.1, §3.2, §3.3, §3.4** exactly, with the `<ChartContainer>` ruling above (keep it, remove everything else spec §3.2 lists). Concretely:

- [ ] **Step 1: Remove the Recharts/Brush/custom-range machinery**

Delete: the `Brush`, `ComposedChart`, `Area`, `Line`, `Bar`, `BarChart`, `Cell`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ReferenceLine`, `ResponsiveContainer`, `LabelList` import from `"recharts"` (line 18-33 of the current file). Delete `brushRange` state, `handleBrushChange`, `clearCustomRange`, the `Custom` pill button block (lines ~308-324), and the entire `DayChangeStrip` function (lines 104-159) — confirmed by the spec (and by grep) that nothing outside this file reads `brushRange`. Keep `DAY_CHANGE_STRIP_MAX_POINTS` deleted too (Task 5 introduces its sparse-mode replacement with its own guard).

- [ ] **Step 2: Add the new imports**

```ts
import { scaleLinear, scaleUtc } from "@visx/scale"
import { LinePath, AreaClosed } from "@visx/shape"
import { LinearGradient } from "@visx/gradient"
import { curveLinear } from "@visx/curve"
```

Keep: `ChartContainer` from `@/components/ui/chart` (per the ruling above — do NOT delete this import), `ChartTooltipContent` from `@/components/ui/chart-tooltip` (Task 4 wires it), `useGoalsData`, `useInView`, `formatInrCompact`/`MASK_TEXT`, `formatShortDate`, `usePrivacy`, `Card`/`CardContent`, `Skeleton`, `cn`, `History` type, `usePrefersReducedMotion`, `deriveMilestones`/`Milestone`, `MilestonePins`/`useMilestoneHover` (Task 4 changes `MilestonePins`' props, this file's call site updates then).

- [ ] **Step 3: Add `useElementWidth` and build scales**

```ts
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [ref])
  return width
}
```

Build `xScale`/`yScale` from `sliced` and `width` exactly per spec §3.3's code block (UTC date parsing via `` new Date(`${d}T00:00:00Z`) ``, margins `{ top: 10, right: 10, bottom: 0, left: 0 }` for now — sparse-mode margins arrive in Task 5).

- [ ] **Step 4: Replace the chart JSX with the visx plot**

Wrap in `<ChartContainer config={chartConfig} className="h-full w-full">` (kept per the ruling), then a plain sized `<div ref={containerRef}>` with an `<svg>` inside using `width`/`height={320}` (dense-mode height only for now — Task 5 branches this), containing:
- The `<LinearGradient>` per spec §3.4 (three-stop version, peak opacity 0.32 — this is the audit's dark-theme-invisible-gradient fix, verify visually in `.dark` before moving on).
- `<AreaClosed>` with `curve={curveLinear}` per spec §3.4.
- `<LinePath>` with `curve={curveLinear}`, `stroke="var(--chart-1)"`, `strokeWidth={2.5}` per spec §3.4 — **no render-prop path interception yet** (plain `d={path(chartData)}`, Task 3 adds the morph).
- Y gridlines (`yScale.ticks(5)` → `<line>` elements, `stroke="var(--border)"`, `strokeDasharray="4 4"`) and axis tick `<text>` elements (replacing `CartesianGrid`/`YAxis`) — dense mode only, per spec §3.9's table (sparse mode's "None" row arrives in Task 5; for this task, always render dense-style chrome since sparse/dense branching is Task 5's job).
- X-axis tick labels — every ~10th point, reusing the existing `formatXLabel` (`date.slice(5)`) — replaces `XAxis`.
- Point labels/dots only when `sliced.values.length <= 12` (existing threshold, ported verbatim from the current `dot={sliced.values.length <= 12}` and the `LabelList` guard) — plain `<circle>` + `<text>` elements now, no glow yet (Task 3 adds it).
- **No tooltip yet** (Task 4 wires it) — remove the old `<Tooltip>` entirely for this task; the chart is visually complete but not interactive.
- **No `<MilestonePins>` render yet in this task** — its props change in Task 4; leave it commented out or temporarily omitted rather than passing stale Recharts-shaped props. Note this in your task report so Task 4's implementer knows it's expected to be missing until then.

- [ ] **Step 5: Visual parity check (manual, this task's actual test)**

```bash
npm run dev
```

Use the Chrome devtools MCP tools to navigate to the running dashboard's Journey screen. Confirm: the line and gradient area render at roughly the same visual weight as before this task (minus the Brush strip and the day-change bar chart, both intentionally gone), gridlines/axis labels present in dense mode, both light and dark themes checked, range pills still switch the data (no morph animation yet — an instant jump is correct and expected at this task's stage). Screenshot both themes.

- [ ] **Step 6: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: PASS. (Recharts imports for `Brush`/`ComposedChart`/etc. are gone from this file — confirm no unused-import lint warning remains.)

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/journey/JourneyChart.tsx
git commit -m "feat(dashboard): rebuild Journey chart plot on visx (static, no morph/glow yet)"
```

---

### Task 3: Path morph + shared glow filter + "today" pulse ring

**Files:**
- Modify: `dashboard/src/components/journey/JourneyChart.tsx`
- Modify: `dashboard/src/components/journey/motion.ts` (add two new exports, front-loaded here — see note below)
- Modify: `dashboard/src/index.css` (one new `@keyframes` block)

**Interfaces:**
- Consumes: `xScale`/`yScale` and the plain `<LinePath>`/`<AreaClosed>` from Task 2.
- Produces: the shared `<defs><filter id="journey-glow">...</filter></defs>` block — Task 4's halo dots (`MilestonePin.tsx`) apply `filter="url(#journey-glow)"` by that exact id. Also produces `SPRING_CONFIG_NUMBER` and `SPRING_CONFIG_MILESTONE_POP` (both `as const` objects) exported from `./motion` — Task 4 and Task 7 consume `SPRING_CONFIG_MILESTONE_POP`; Task 6 consumes `SPRING_CONFIG_NUMBER`.

**Note on why the `motion.ts` exports live here, not in Task 6 (where spec.md §6 introduces them):** Task 4 (next) needs `SPRING_CONFIG_MILESTONE_POP` for the halo-dot pop, and Task 4 runs before Task 6 in this plan's execution order. Adding both constants now — before either consumer — avoids Task 4 importing a not-yet-existing export. Task 6 below just consumes `SPRING_CONFIG_NUMBER`, already in place by then.

Implement per **spec.md §3.5** (path morph), **§3.6** (glow filter), **§3.7** (pulse ring), and **§6**'s `motion.ts` code block (for the two constants only, not the wiring — that's Task 7) exactly.

- [ ] **Step 1: Add the two spring configs to `motion.ts`**

```ts
export const SPRING_CONFIG_MILESTONE_POP = { type: "spring", stiffness: 420, damping: 18, mass: 0.6 } as const
export const SPRING_CONFIG_NUMBER = { type: "spring", stiffness: 180, damping: 22, mass: 1 } as const
```

- [ ] **Step 2: Add the glow filter `<defs>` block**

Per spec §3.6's exact SVG — add once inside the chart's `<svg>`, alongside the existing gradient `<defs>` from Task 2 (can be the same `<defs>` element or a sibling one — either is valid SVG).

- [ ] **Step 3: Wire path-morph via the `LinePath`/`AreaClosed` render-prop + `d3-interpolate-path`**

Per spec §3.5 steps 1-6 exactly: capture the previous rendered `d` in a `useRef<string>`, build `interpolatePath(prevD, nextD)` on range change, drive `t` 0→1 over `PATH_MORPH_DURATION_MS` (declare `const PATH_MORPH_DURATION_MS = 400` for now — Task 5 branches this to 300 in sparse mode) via `motion`'s `animate()` imported from `"motion"` (the core entry — confirm against Task 1's verified API), easing `[0.16, 1, 0.3, 1]` (the `--ease-out` token's numeric values, reused not referenced). Key the effect on `range` only (spec §3.5.6), not on `chartData` identity — a data refetch that doesn't change `range` must not re-trigger the morph. Reduced motion (`usePrefersReducedMotion()`, already imported): skip the tween, set `d` directly to `nextD`.

- [ ] **Step 4: Add the "today" pulse ring**

Add the CSS keyframes to `dashboard/src/index.css` (find the existing `@keyframes` block region near `--animate-chat-in`, around line 207, and add alongside):

```css
@keyframes journey-pulse-ring {
  0% { r: 4; opacity: 0.4; }
  100% { r: 14; opacity: 0; }
}
```

In `JourneyChart.tsx`, render two `<circle>` elements at the last point's `(xScale, yScale)` coordinates: a static filled inner dot, and — only when `!reduced` — an outer ring circle with `style={{ animation: "journey-pulse-ring 1.8s var(--ease-out) infinite" }}`. When `reduced` is true, omit the outer ring circle entirely (not just pause it — spec §3.7's explicit reduced-motion rule, a static filled dot is the correct reduced state). Apply `filter="url(#journey-glow)"` to both the line's `<path>` stroke and the pulse ring.

- [ ] **Step 4: Visual + interaction check**

```bash
npm run dev
```

Click through the range pills (1M/3M/6M/1Y/All) and confirm the line/area visibly morph between shapes over ~400ms rather than jumping instantly. Confirm the pulse ring loops on the last point. Toggle OS-level `prefers-reduced-motion` (via Chrome devtools rendering emulation) and confirm: morph becomes instant, pulse ring disappears (static dot only). Both themes.

- [ ] **Step 5: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/journey/JourneyChart.tsx dashboard/src/components/journey/motion.ts dashboard/src/index.css
git commit -m "feat(dashboard): add path-morph range transitions, glow filter, and pulse ring to Journey chart"
```

---

### Task 4: `MilestonePin.tsx` → halo dots + manual tooltip wiring

**Files:**
- Modify: `dashboard/src/components/journey/MilestonePin.tsx` (full rewrite of contents, same filename/exports)
- Modify: `dashboard/src/components/journey/JourneyChart.tsx` (tooltip wiring, `MilestonePins` call site)

**Interfaces:**
- Consumes: `xScale: (date: Date) => number`, `yScale: (value: number) => number` from Task 2/3's `JourneyChart.tsx`; the shared `filter="url(#journey-glow)"` and `SPRING_CONFIG_MILESTONE_POP` (from `./motion`) both from Task 3.
- Produces: `MilestonePins({ milestones, xScale, yScale, activeDate, justCrossedDate }: { milestones: Milestone[]; xScale: (date: Date) => number; yScale: (value: number) => number; activeDate?: string; justCrossedDate?: string | null })` — **replaces** the old `{ milestones, slicedDates, activeDate }` signature (the caller in `JourneyChart.tsx` now passes already-filtered `visibleMilestones` directly, no `slicedDates` prop — filtering happens at the call site, same as today). `useMilestoneHover` — unchanged signature, reused verbatim. Task 7 supplies a real `justCrossedDate` value at the call site (passes it in from `JourneyChart.tsx`'s own `history`-derived computation, not from this task — Task 7 adds that computation); until then this task's own call-site update (Step 2 below) passes `undefined`, which is valid per the optional prop.

Implement per **spec.md §5** and **§3.8** exactly.

- [ ] **Step 1: Rewrite `MilestonePin.tsx`**

Delete the `useXAxisScale`/`useYAxisScale` Recharts hook imports and the pin-path SVG. New implementation per spec §5's code sketch: for each milestone, `<g transform={`translate(${xScale(new Date(m.date))}, ${yScale(m.value)})`}>` containing a filled `<circle r={5} fill="var(--chart-3)" filter="url(#journey-glow)" />`. Inline `<text>` label only for the 1-2 most significant milestones — reuse the existing `chartMilestones()` crossing-outranks-appearance dedup output from `JourneyChart.tsx` (already computed there, passed via the `milestones` prop — no new significance logic in this file). Keep `useMilestoneHover` exactly as-is (it's already framework-agnostic, per spec §5). Add the spring pop: when `justCrossedDate === milestone.date`, wrap the `<circle>` in a `motion`-driven scale animation `1 → 1.15 → 1` using `SPRING_CONFIG_MILESTONE_POP` (imported from `./motion` — already exported as of Task 3).

- [ ] **Step 2: Wire the manual tooltip in `JourneyChart.tsx`**

Per spec §3.8: render an invisible full-height/width `<rect>` overlay with `onPointerMove` that finds the nearest data point by x-position (linear scan over `chartData` — this dataset is small, no need for binary search) and sets local `{ active, payload, label }` state. Position `<ChartTooltipContent>` via absolute CSS positioning at the computed `xScale`/`yScale` coordinates for the matched point. Pass the same `formatter` logic the old Recharts `<Tooltip>` used (masked check → `MASK_TEXT`, else `formatInrCompact`). Re-enable the `MilestonePins` render (left commented/omitted since Task 2) with the new props: `milestones={visibleMilestones} xScale={xScale} yScale={yScale} activeDate={activeMilestoneDate ?? undefined}` (`justCrossedDate` arrives in Task 7 — pass `undefined` for now, or omit the prop, since it's optional).

- [ ] **Step 3: Interaction check**

```bash
npm run dev
```

Hover over the chart line and confirm the tooltip appears near the pointer with the correct date/value, masked correctly when privacy mode is on. Confirm milestone halo dots render at the correct positions (compare against where the old teardrop pins used to sit, for a couple of known milestones) and that hovering a milestone's date (via the line tooltip) also highlights that milestone per `useMilestoneHover`'s existing behavior.

- [ ] **Step 4: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/journey/MilestonePin.tsx dashboard/src/components/journey/JourneyChart.tsx
git commit -m "feat(dashboard): rewrite Journey milestone pins as halo dots, wire manual tooltip"
```

---

### Task 5: Sparse/dense mode split + `DeltaChipRail.tsx`

**Files:**
- Create: `dashboard/src/components/journey/DeltaChipRail.tsx`
- Modify: `dashboard/src/components/journey/JourneyChart.tsx`

**Interfaces:**
- Consumes: `formatShortDate` from `./journal`, `formatInrCompact`/`MASK_TEXT` from `@/lib/format` (both already used elsewhere in this dir).
- Produces: `DeltaChipRail({ dates, values, masked }: { dates: readonly string[]; values: readonly number[]; masked: boolean })` — a standalone component, no further consumers in this plan.

Implement per **spec.md §3.9** (mode table) and **§4** (`DeltaChipRail`) exactly.

- [ ] **Step 1: Create `DeltaChipRail.tsx`**

Per spec §4's code sketch — one chip per adjacent-day transition (same `changes` derivation the deleted `DayChangeStrip` used: `delta = values[i] - values[i-1]` for `i` from 1). Layout: `overflow-x-auto` flex row, one `<span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs">` per chip with a `TrendingUp`/`TrendingDown`/`Minus` icon from `lucide-react` (match `AccountRoads.tsx`'s exact icon-choice logic: `delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus`), the short date via `formatShortDate`, and the signed delta via `formatInrCompact`, masked to `MASK_TEXT` — color classes `text-gain`/`text-loss`/`text-muted-foreground` matching `AccountRoads.tsx`'s `RoadRowItem` exactly. Render `null` when `values.length < 2`.

- [ ] **Step 2: Add the dense/sparse mode branch to `JourneyChart.tsx`**

```ts
const SPARSE_THRESHOLD = 8
const mode: "sparse" | "dense" = sliced.values.length < SPARSE_THRESHOLD ? "sparse" : "dense"
```

Branch per spec §3.9's table: height (320px dense / 220px sparse), gridlines+Y-axis (dense only), X-axis labels (dense: every ~10th point via `formatXLabel`; sparse: inline date labels directly under each point), point labels/dots (dense: only if `≤12` points, existing rule; sparse: always, larger radius 5px vs dense 3px, glow filter applied), margins (`{ top: 10, right: 10, bottom: 0, left: 0 }` dense / `{ top: 24, right: 16, bottom: 8, left: 16 }` sparse), `PATH_MORPH_DURATION_MS` (400 dense / 300 sparse — update Task 3's constant to be mode-dependent), and render `<DeltaChipRail dates={sliced.dates} values={sliced.values} masked={masked} />` below the chart only when `mode === "sparse" && sliced.values.length >= 2`. On a mode change specifically (not a same-mode range change), cross-fade the chart body 150ms via a plain CSS opacity transition with `motion-reduce:transition-none` — do not path-morph across a mode change.

- [ ] **Step 3: Check both modes**

```bash
npm run dev
```

Pick a range that yields <8 points (e.g. this account's current history is very short — "1M" or even "All" may already be sparse; check the real exported `dashboard/public/data/history.json` to confirm which range triggers which mode) and confirm: no gridlines/Y-axis, inline point labels+dates, `DeltaChipRail` renders below with correct signed deltas. Pick/construct (or wait for) a ≥8-point range and confirm dense mode's chrome is unchanged from Task 2/3. Both themes, both masked states.

- [ ] **Step 4: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/journey/DeltaChipRail.tsx dashboard/src/components/journey/JourneyChart.tsx
git commit -m "feat(dashboard): add sparse/dense chart mode split and DeltaChipRail"
```

---

### Task 6: `animation.ts` — spring-based `useAnimatedNumber`

**Files:**
- Modify: `dashboard/src/components/journey/animation.ts`

**Interfaces:**
- Consumes: `SPRING_CONFIG_NUMBER` from `./motion` (already exported as of Task 3 — do not re-add it here).
- Produces: `useAnimatedNumber(target: number, duration?: number): number` — **public signature unchanged**, verified against its two existing call sites (`JourneyWorkspace.tsx`'s `Headline`, `dashboard/src/components/journey/TodayPanel.tsx`) needing zero changes.

Implement per **spec.md §7**, using Task 1's confirmed real `motion` API names (not necessarily the exact `useMotionValue`/`useSpring`/`.on("change", ...)` names in the spec's illustrative code, if Task 1 found them different).

- [ ] **Step 1: Rewrite `useAnimatedNumber` in `animation.ts`**

Per spec §7's pattern, using Task 1's verified `motion` API. Delete the old `requestAnimationFrame`-based eased-tween implementation entirely (spec §7: not kept as a reduced-motion fallback — reduced motion means "jump straight to target" either way). Keep the `duration` parameter in the signature for source compatibility even though springs don't take a fixed duration (it becomes unused internally) — add a one-line comment saying so explicitly, per this repo's "explain non-obvious decisions" convention.

- [ ] **Step 2: Verify the two call sites need no changes**

```bash
grep -n "useAnimatedNumber" dashboard/src/components/journey/JourneyWorkspace.tsx dashboard/src/components/journey/TodayPanel.tsx
```

Confirm both calls (`useAnimatedNumber(latest.totals.valueBase)` in `JourneyWorkspace.tsx`'s `Headline`, `useAnimatedNumber(delta)` in `TodayPanel.tsx`) compile unchanged against the new signature.

- [ ] **Step 3: Behavior check**

```bash
npm run dev
```

Trigger a refresh that changes the headline total (or use React DevTools to force a prop change) and confirm the number animates with a visible spring settle (slight overshoot-then-settle on a large jump), not the old cubic ease-out. Confirm a same-value refresh produces no visible motion. Toggle reduced-motion and confirm the number jumps straight to target with no overshoot.

- [ ] **Step 4: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/journey/animation.ts
git commit -m "feat(dashboard): rewrite useAnimatedNumber on motion spring physics"
```

---

### Task 7: Entrance stagger + goal crossing pop + chart halo pop wiring

**Files:**
- Modify: `dashboard/src/components/journey/JourneyWorkspace.tsx`
- Modify: `dashboard/src/components/journey/GoalMilestones.tsx`
- Modify: `dashboard/src/components/journey/JourneyChart.tsx`

**Interfaces:**
- Consumes: `SPRING_CONFIG_MILESTONE_POP` from `./motion` (Task 3). `MilestonePins`' `justCrossedDate` prop (Task 4).
- Produces: nothing further consumed by later tasks in this plan.

Implement per **spec.md §8** (entrance) and **§6** (crossing-pop wiring, including rationale.md §4's explanation of why the chart dot's pop does NOT reuse `useGoalCrossing`).

- [ ] **Step 1: `JourneyWorkspace.tsx` — replace `Entrance` with `motion/react` stagger**

Delete the manual `Entrance` function (the `setTimeout` + CSS-transition-class component, currently wrapping `Headline`, `StalenessBanner`, `LiveJobsRow`, `JourneyChart`, the `TodayPanel`/`AccountRoads`/`GoalMilestones` row, and `YearStrip`). Replace with `motion/react`'s declarative stagger per spec §8's exact code: a `<motion.section variants={container} initial="hidden" animate="show">` wrapping one `<motion.div variants={item}>` per current `Entrance`-wrapped child, `container` using `staggerChildren: 0.06`, `item` using `{ opacity: 0, y: 12 }` → `{ opacity: 1, y: 0 }` with `{ type: "spring", stiffness: 300, damping: 26 }` (12px rise, not the old imperceptible 6px — audit §1.4/motion-spec §1). `prefers-reduced-motion` → pass `initial="show"` directly (skip `"hidden"` entirely) rather than relying on `motion`'s own reduced-motion handling.

- [ ] **Step 2: `GoalMilestones.tsx` — goal card crossing pop**

Inside `useGoalCrossing`'s existing loop (the one that currently calls `toast(...)` once per newly-crossed goal, lines 78-93), also `setJustCrossedGoalId(goal.id)` for one render, cleared via `setTimeout(() => setJustCrossedGoalId(null), 600)` (matches the spring settle duration). Change `useGoalCrossing`'s return type from `void` to `string | null` (the current `justCrossedGoalId`) so the component can read it. Wrap the crossed goal's `<Badge variant="success">` (lines 367-371) in a `motion.span` scale pop (`1 → 1.15 → 1`, `SPRING_CONFIG_MILESTONE_POP`) keyed on `justCrossedGoalId === goal.id`. Reduced motion → no pop, `Badge` appears at final state (per a11y-spec §6's table — the crossing toast itself still fires, unaffected).

- [ ] **Step 3: `JourneyChart.tsx` — chart halo dot pop wiring**

Per spec §6 and rationale.md §4: compute `justCrossedDate = milestones.find(m => m.date === history.dates.at(-1))?.date ?? null` directly from `history` (no `useGoalCrossing` involvement — this is deliberately a simpler, ledger-derived mechanism, not goal-keyed). Pass `justCrossedDate` into the `<MilestonePins>` call site (already accepting this prop since Task 4).

- [ ] **Step 4: Behavior check**

```bash
npm run dev
```

Reload the Journey screen and confirm the cards fade/rise in with a visible ~12px spring stagger (not the old imperceptible version). If a goal is at/near its target, verify crossing it (or simulate via a temporary target edit) pops the `Badge` once, not on every render, and not again on a later reload of the same crossed goal. Confirm the chart's milestone dot for the most recent ledger day (if any) pops once on mount when that day carries a milestone. Reduced motion: entrance is instant (no stagger), no pops render.

- [ ] **Step 5: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/journey/JourneyWorkspace.tsx dashboard/src/components/journey/GoalMilestones.tsx dashboard/src/components/journey/JourneyChart.tsx
git commit -m "feat(dashboard): motion entrance stagger, goal crossing pop, chart milestone pop"
```

---

### Task 8: `EmptyGlyph.tsx`

**Files:**
- Create: `dashboard/src/components/journey/EmptyGlyph.tsx`
- Modify: `dashboard/src/components/journey/JourneyChart.tsx` (the `isEmpty` branch)
- Modify: `dashboard/src/components/journey/GoalMilestones.tsx` (the `goals.length === 0` branch)

**Interfaces:**
- Produces: `EmptyGlyph({ className }: { className?: string })` — no further consumers in this plan.

Implement per **spec.md §9** exactly (the 12-line inline-SVG component, `aria-hidden="true"`).

- [ ] **Step 1: Create `EmptyGlyph.tsx`** — exact SVG from spec §9.

- [ ] **Step 2: Wire into `JourneyChart.tsx`'s empty state**

Replace the current plain-text `isEmpty` branch (`<div className="flex h-80 items-center justify-center text-xs text-muted-foreground">No history yet...</div>`) with the glyph rendered above the same text.

- [ ] **Step 3: Wire into `GoalMilestones.tsx`'s empty state**

Replace the plain `<p>No goals yet — set a target to watch</p>` (line 341-343) with the glyph above the same text, same styling wrapper.

- [ ] **Step 4: Visual check**

```bash
npm run dev
```

If real data makes both empty states hard to trigger, temporarily stub `history.dates = []` / `goals = []` in a local dev check (revert before committing) or confirm visually via the component in isolation. Both themes.

- [ ] **Step 5: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/journey/EmptyGlyph.tsx dashboard/src/components/journey/JourneyChart.tsx dashboard/src/components/journey/GoalMilestones.tsx
git commit -m "feat(dashboard): add EmptyGlyph for Journey chart and goals empty states"
```

---

### Task 9: Full state-matrix QA + bundle-size report

**Files:** none (verification only; a fix here means returning to the relevant earlier task's file, not new scope)

**Interfaces:** none — this task consumes everything Tasks 1-8 produced and asserts it is all simultaneously correct.

This task is the engineer's own close-out check per spec.md §10 and the Handoff note's item 9 — it does **not** replace the independent `dashboard-design-reviewer` pass that follows this plan's execution; it's the bar this plan must clear before handing off to that review.

- [ ] **Step 1: Run the existing Journey e2e smoke test**

```bash
cd dashboard
npx playwright test e2e/journey-os.spec.ts
```

Expected: PASS, including the "zero console errors" assertion — this is the fastest way to catch a runtime crash (e.g. a leftover `useChartConfig` throw, a missing `motion` export) across all three tests in that file.

- [ ] **Step 2: Full state matrix, both themes, both masked states**

Using the Chrome devtools MCP tools against `npm run dev`, walk spec.md §10's table row by row: Loading, Error (if reproducible), Empty, Sparse, Dense, both themes (light/dark), masked/unmasked, and every row of `accessibility/a11y-spec.md` §6's reduced-motion table (all 8, individually — do not spot-check one and assume the rest). Screenshot each distinct state.

- [ ] **Step 3: Chart resize check**

Resize the browser window (or the pane, if applicable) and confirm the chart re-measures via `ResizeObserver` and re-lays-out as a static change — NOT a path-morph tween (spec §10's last row — only range-pill changes should trigger the morph).

- [ ] **Step 4: Bundle-size delta — required, not optional (spec §0.5, Open Dependencies)**

```bash
npm run build
```

Report the actual raw + gzip size delta for the new chunk(s) versus a build from before Task 1 (check `dist/assets/*.js` sizes, or use the build output's own summary). Compare against the ~20-23KB gzip estimate — flag explicitly if the real number differs meaningfully, per spec's explicit instruction not to silently accept an unmeasured estimate.

- [ ] **Step 5: Full verification suite**

```bash
npm run typecheck && npm run lint && npm run check:contract
```

Expected: all PASS.

- [ ] **Step 6: Commit (if step 2-4 surfaced any fix)**

If the QA pass is clean, no commit is needed for this task beyond a final confirmation — report the bundle-size number and the full state-matrix results. If any row failed, fix it in the relevant earlier task's file(s), re-run the affected checks, and commit the fix with a message naming which state-matrix row it fixes.

---

## Handoff to review

Once all 9 tasks are complete (via `superpowers:subagent-driven-development`'s per-task review loop), dispatch `dashboard-design-reviewer` for the independent QA pass — it checks spec fidelity, this repo's non-negotiables, and drives the live app itself, per its own agent brief (`.claude/agents/dashboard-design-reviewer.md`). Only after that review is clean should this branch move to `superpowers:finishing-a-development-branch`.
