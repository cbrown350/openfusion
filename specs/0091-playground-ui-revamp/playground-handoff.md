# OpenFusion Playground — Implementation Handoff

This document is the **scope and invariants** for porting the prototype
`openfusion-playground.html` into the real React/TypeScript app. Read it
*before* touching any file.

---

## 1. Goal (one line)

Replace the contents of `ui/src/pages/Playground.tsx` with the **Studio 3-pane
workbench** shown in `openfusion-playground.html` — a session-history/examples
rail (left), prompt+context composer with persona picker (center), and a live
result pane with per-candidate progress, run-metadata bar, streamed synthesized
answer, and judge breakdown (right) — **without disturbing the rest of the app.**

---

## 2. Hard invariants — DO NOT touch these (unless §3 says so)

| File | Rule |
|---|---|
| `ui/src/App.tsx` | Title bar, nav, routing stay **byte-identical**. The *only* allowed edit is the single width line in §3. Do not restyle the header, logo, pills, or nav. |
| `ui/src/index.css` | The class vocabulary is **shared and stable**: `.glass`, `.glass-soft`, `.field`, `.btn`, `.btn-primary`, `.btn-icon`, `.toggle`, the phase-chip pattern, the `text-xs uppercase tracking-wide text-white/40` label pattern. Reuse them. You MAY add new component-scoped classes; do not redefine the shared ones destructively. |
| `ui/src/components/FusionBreakdown.tsx` | `GenerationText`, `CandidatesView`, `JudgeView`, `SubCallStats` are **reused, not rebuilt**. The prototype's result pane is a layout around these existing components. |
| `ui/src/components/GenerationText.tsx` | Used as-is for the synthesized answer surface. |
| Dependencies | **No new npm packages** (project rule SC-006). The prototype is dependency-free; keep it that way. Tailwind v4 + React 19 only. |

If your plan requires editing `App.tsx` beyond §3, stop — you are redesigning the
shell. That is out of scope.

---

## 3. The ONE allowed change to the shell

The Playground needs a wider canvas than the app's default `max-w-5xl`.
Implement this with **a width token**, so every other page is untouched:

- In `ui/src/index.css`, add: `--shell-max: 60rem;` and make the header +
  `<main>` containers use `max-width: var(--shell-max)`.
- On the `/playground` route only, set `--shell-max: 80rem` (≈ `max-w-7xl`).
  Cleanest: `App.tsx` does
  `document.documentElement.style.setProperty('--shell-max', location.pathname.startsWith('/playground') ? '80rem' : '60rem')`
  in a layout effect.
- Every other route falls back to `60rem` → **identical to today.**

If you'd rather not touch `App.tsx` at all, the alternative is to keep the
Playground at `max-w-5xl` and stack the panes vertically on narrower widths (the
prototype already collapses to a single column under 1040px). Confirm with the
owner which you pick.

---

## 4. Read these files first (in order)

1. `openfusion-playground.html` — the visual + interaction spec (this is the
   target). Note its top-of-file comment maps prototype elements → real files.
2. `ui/src/App.tsx` — the shell you must preserve.
3. `ui/src/pages/Playground.tsx` — the file you are **replacing the body of**.
4. `ui/src/index.css` — the design primitives + tokens (`#1a2a3a` / `#4cd0b0`
   / `#3498db`).
5. `ui/src/components/FusionBreakdown.tsx` + `GenerationText.tsx` — the
   breakdown components you reuse in the result pane.
6. `ui/src/api.ts` + `ui/src/lib/models.ts` — the real data layer (see §6).
7. `specs/009-playground-ui/` — the original Playground product spec, for any
   requirement ambiguity.

---

## 5. Seam map — prototype element → real implementation

| Prototype (HTML) | Real implementation |
|---|---|
| Header / nav / logo / pills | **Already exists** in `App.tsx` — do not port. |
| Left rail: session history | New. Backed by `GET /api/activity` (list past runs) → `ui/src/api.ts`. "Reload" = load that run's result into the right pane. |
| Left rail: example prompt library | New, static array of fusion-tuned starters (see prototype's `EXAMPLES`). No backend. |
| Center: persona `<select>` | `list_personas` / `GET /api/personas`. Real personas: Generalist, QA/Code Reviewer, Researcher, PM/Strategist, System Architect. |
| Center: prompt + context `<textarea>` | Direct map to `fusion({ prompt, context })`. |
| Center: Run button (`.btn-primary`) | **Fix the latent bug**: real markup is `class="btn-primary"` without `.btn`, and there is no base `button{}` reset — so it renders as a nub. Make `.btn-primary` self-contained (padding, min-height, radius, cursor, hover/active/disabled) in `index.css`. Add the bolt→spinner state + disabled-when-empty. |
| Center: ⌘/Ctrl+Enter to run + token estimate | New. Token estimate is a heuristic over `prompt`+`context` length (label it `~N tok` — it's an estimate). |
| Right: per-candidate progress dots | New. During the run, reflect `/api/runtime` phase + per-candidate status (`ok`/`timeout`/`error`). |
| Right: run-metadata bar | Derived from the completed run: total cost · tokens · latency · survivors/total · persona · source. Real fields from `GET /api/activity/:id`. |
| Right: **streamed synthesized answer** | **⚠️ Simulated in the prototype** (`streamAnswer()` reveals text block-by-block). Wire to the **real** stream: poll `GET /api/runtime` until phase = `synthesis` complete, then render via `<GenerationText>`. Drop the shim. |
| Right: judge breakdown (consensus / contradictions / uniqueInsights / blindSpots) | Reuse `<JudgeView>` from `FusionBreakdown.tsx`. Data = the run's `analysis` object. |
| Right: candidate rows | Reuse `<CandidatesView>` from `FusionBreakdown.tsx`. |

---

## 6. What is simulated in the prototype vs. real

The prototype **simulates the run** client-side (it lands on four precomputed
example results, and `streamAnswer()` fakes token streaming). These are the
**exact seams** to wire to the real backend — they are deliberately isolated:

| Simulated (prototype) | Real (implement this) |
|---|---|
| `run()` picks a canned example result | `POST /api/fusion` → get run id |
| Fixed `setTimeout` phase progression | Poll `GET /api/runtime` for real `fan-out → analysis → synthesis` phases |
| `streamAnswer()` char-by-char reveal | Live synthesis token stream / final result via `GET /api/activity/:id` |
| `EXAMPLES` / mock candidate metrics | Keep examples; replace mock metrics with real `/api/activity/:id` fields |

Everything else (layout, classes, components, interactions) ports as-is.

---

## 7. Suggested file changes (expected diff shape)

- **`ui/src/pages/Playground.tsx`** — full body rewrite (this is the whole
  task). Keep the existing page-title block + import the shared components.
- **`ui/src/index.css`** — (a) self-contained `.btn-primary` fix, (b) the
  `--shell-max` token + container wiring, (c) new component-scoped classes for
  the rail / metadata bar / progress dots if you don't inline them in Tailwind.
- **`ui/src/App.tsx`** — **at most** the one `--shell-max` layout-effect line
  from §3. Nothing else.
- **Optional new**: `ui/src/components/PlaygroundRail.tsx`,
  `RunMetadataBar.tsx`, `CandidateProgress.tsx` if you prefer to keep
  `Playground.tsx` under ~400 lines (project rule: keep files under ~1000).
- **No** changes to `FusionBreakdown.tsx`, `GenerationText.tsx`, `api.ts`
  (unless the api client genuinely lacks a method you need — then add one, don't
  fork).

If your diff touches anything outside this list, re-read §2.

---

## 8. Acceptance criteria (definition of done)

- [ ] Playground renders the 3-pane workbench; panes collapse to a single
      column under ~1040px with no horizontal scroll.
- [ ] Header/logo/nav/pills are visually identical to the other pages (same
      width on Playground if §3 token is used; unchanged elsewhere).
- [ ] Run is driven by the **real** `POST /api/fusion` + `/api/runtime` +
      `/api/activity/:id` — no canned/simulated results remain.
- [ ] Synthesized answer renders through `<GenerationText>`; per-candidate
      status reflects real `ok`/`timeout`/`error`.
- [ ] Breakdown reuses `<CandidatesView>` + `<JudgeView>` (not a reimplementation).
- [ ] Persona picker loads from the real persona list; `context` is sent when
      present.
- [ ] `.btn-primary` renders as a proper button app-wide (the bug fix benefits
      every page). ⌘/Ctrl+Enter runs; button is disabled when prompt is empty.
- [ ] Session-history rail loads real past runs; reload restores a result.
- [ ] No new npm dependencies. `npm run build` + existing tests pass
      (`tests/playground-api.test.ts` in particular).
- [ ] `App.tsx` diff is ≤ the one `--shell-max` line.

---

## 9. Anti-patterns to refuse (from the product rules)

No demo/viewport/platform toggles, no "settings" panels, no target-count badges,
no invented metrics, no filler copy, no new gradients beyond the existing
teal→blue primary, no emoji icons. The Playground must read as shipped product
UI, not a design-spec dashboard.
