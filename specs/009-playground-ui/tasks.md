# Tasks: 009-playground-ui

**Input**: Design documents from `/specs/009-playground-ui/`

**Prerequisites**: plan.md ✅, spec.md ✅ (US1–US3), research.md ✅, data-model.md ✅, contracts/playground-api.md ✅, quickstart.md ✅

**Tests**: The project has a strong test convention (167 tests green, Vitest + `registerFauxProvider()`). Server-side tasks follow TDD — tests in `tests/playground-api.test.ts` are written RED, then the route turns them GREEN. The UI has no test harness today (surgical — no harness added); UI tasks are validated via the manual scenarios in `quickstart.md`.

**Organization**: Tasks grouped by user story. US1 (Playground) is the MVP — independently shippable (a working browser fusion with config still in 4 tabs). US2 (Settings consolidation) is a parallel-capable reorg. US3 (unconfigured UX) depends on both.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Server**: `src/` at repository root (TypeScript, ESM, NodeNext)
- **UI**: `ui/src/` (React 19 + Vite 8 + Tailwind 4, CSS-first — no `tailwind.config.js`)
- **Tests**: `tests/` at repository root (Vitest)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm a clean baseline before additive work. No new dependencies (SC-006), no new build config — this feature is purely additive (one route, one page, one shell, one refactor).

- [x] T001 Verify baseline: `pnpm install` + `pnpm typecheck` + `pnpm test` all green on branch `009-playground-ui` before any changes

---

*(No Phase 2 Foundational — this feature introduces no shared schema, no shared models, no blocking prerequisites. US1 and US2 touch disjoint files except for `ui/src/App.tsx` nav wiring, which is sequenced within each story. See Dependencies.)*

---

## Phase 2: User Story 1 — Run a fusion from the browser (Priority: P1) 🎯 MVP

**Goal**: A user opens the dashboard, lands on the **Playground** (new first tab), types a prompt (+ optional context + persona), hits Run, watches live progress, and reads the synthesized answer + candidate/judge breakdown — with zero MCP client setup.

**Independent Test**: Configure ≥2 candidates + judge + keys (via the still-existing Candidates tab), open `/`, run a prompt in the Playground, observe a synthesized answer + the run in Generations. (quickstart.md T5–T7 + E1.)

### Tests for User Story 1 (TDD — write FIRST, watch them FAIL)

> **NOTE**: These cover the `POST /api/fusion` contract (contracts/playground-api.md). They go RED before T005 implements the route, then GREEN.

- [x] T002 [US1] Write `tests/playground-api.test.ts` covering the `POST /api/fusion` contract against a temp DB + `registerFauxProvider()` (follow the deterministic-fusion pattern in `tests/fusion.test.ts`):
  - **(a)** valid `{ prompt }` with a configured faux config → `ok:true`, `status:"success"` (or `"partial"`), non-empty `answer`, present `activityId` matching an `activities` row
  - **(b)** unconfigured (empty config, <2 candidates) → `ok:false`, `status:"error"`, `needsConfig:true`, **no `activityId`** (gate ran before `recordActivity`), error message names the missing requirement
  - **(c)** missing/empty `prompt` → HTTP 400 `{ error:"BAD_REQUEST", detail:/prompt is required/ }`
  - **(d)** a body with a stray `apiKey` field is accepted (ignored), runs normally, and the response carries **no** key material (Constitution IV — FR-005)
  - **(e)** with `config.settings.personaPolicy = "strict"` + a requested `persona` override → the `activities` row records `persona_source = "active"` (proves `source:"ui"` activated feature 006's dormant exemption — SC-003)

### Implementation for User Story 1

- [x] T003 [P] [US1] Add `PlaygroundFusionResponse` type + `runFusion(body)` method to `ui/src/api.ts` (POST `/api/fusion`; response shape per contracts/playground-api.md)
- [x] T004 [P] [US1] Extract `CandidatesView`, `JudgeView`, `SubCallStats`, and the `AnalysisShape` type from `ui/src/pages/Generations.tsx` into a new `ui/src/components/FusionBreakdown.tsx`; update `Generations.tsx` to import them from there (refactor of existing local helpers — single source of truth for breakdown rendering; no behavior change to Generations)
- [x] T005 [US1] Create `POST /api/fusion` route in `src/server/api/fusion.ts` and mount it in `src/server/ui-server.ts` (one line, alongside the other `app.use("/api/…", …)` mounts):
  - validate body — 400 if `prompt` missing/empty after `trim()`
  - call `runFusion({ prompt, context, persona, config: loadConfig(), db, source: "ui" })` — **`source:"ui"` is load-bearing** (FR-004, activates the persona-policy exemption; omit `onPersonaEvent` — UI source never emits)
  - project `FusionResult` → `PlaygroundFusionResponse` `{ activityId?, ok, status, answer?, error?, needsConfig? }` (omit `activityId` on gate failure; omit `errorKind` in v1 — YAGNI, see data-model.md)
  - never accept/echo key material (FR-005) — turns T002(a)–(e) GREEN
  - FR-008 (logged identically to an MCP fusion) holds **by construction** — the route calls `runFusion`, which is the single logging site; no extra work. Verified empirically by SC-002 / quickstart E1.
- [x] T006 [US1] Create `ui/src/pages/Playground.tsx` — the Playground page:
  - form: `prompt` (required textarea), `context` (optional textarea), `persona` (dropdown from `GET /api/personas`, default "Active: <name>")
  - Run button → `api.runFusion(…)`, disabled while pending (client-side guard against double-submit)
  - **live progress**: while pending, poll `api.getStatus()` (`GET /api/runtime`) at ~2s, paused when hidden — mirror `Dashboard.tsx`'s `ServerStatus` widget; filter `fusions` by the in-flight `activityId`; render phase chips (fan-out → analysis → synthesis) + candidate count
  - **result**: on resolve, render `answer` via the existing `GenerationText` component; then `api.getActivityDetail(activityId)` and render the breakdown via `FusionBreakdown` (collapsed-by-default disclosure — research.md R-007)
  - **response rendering of failure states (FR-014 — sole owner)**: render `ok:false, needsConfig:true` as an actionable amber state with a link to Settings → Candidates; render other `ok:false` as a red error with the `error` text. (T010 handles only the *upfront* pre-Run detection; this bullet owns all post-Run response rendering.)
  - depends on T003 (api method), T004 (FusionBreakdown), T005 (endpoint)
- [x] T007 [US1] Wire the Playground into `ui/src/App.tsx`: add the **Playground** tab as the **first** nav entry (FR-001), add a `/playground` route, and make `/` render the Playground (default landing). Leave the existing 4 config tabs in place for now (US2 replaces them).

**Checkpoint**: A user can run a fusion end-to-end from the browser. The Playground is the first/default tab. Config is still spread across 4 tabs (fixed in US2). Run quickstart.md T5–T7.

---

## Phase 3: User Story 2 — Consolidate into one Settings tab (Priority: P1)

**Goal**: Replace the four top-level config tabs (Candidates, Judge, Personas, API Keys) with a single **Settings** tab whose left sidebar navigates the four sub-sections. The existing page components render unchanged inside the shell.

**Independent Test**: Open Settings, click each sidebar item, confirm each existing page renders and is fully functional (save a candidate, flip a toggle, create a persona, test a provider). (quickstart.md T8.)

*No automated tests — UI has no test harness; this story touches no server code. Validated via quickstart.md T8.*

### Implementation for User Story 2

- [x] T008 [P] [US2] Create `ui/src/pages/Settings.tsx` — the Settings shell:
  - left sidebar (`<aside>`) listing Candidates, Judge, Personas, API Keys with the active one highlighted (FR-010)
  - main pane renders `<Outlet/>` (react-router) so the selected sub-page mounts inside
  - `/settings` index → redirect to `/settings/candidates` (FR-012)
  - the four existing page components (`CandidatesPage`, `JudgePage`, `PersonasPage`, `ApiKeysPage`) are rendered **unchanged** — preserve their `config`/`onChanged` props handshake with `App.tsx` (FR-011)
- [x] T009 [US2] Wire Settings into `ui/src/App.tsx` (sequentially after T007 — same file):
  - remove the four top-level config tabs (Candidates, Judge, Personas, API Keys); add a single **Settings** tab (FR-009)
  - add nested routes `/settings/candidates`, `/settings/judge`, `/settings/personas`, `/settings/keys` rendering the existing pages inside the `Settings` shell (FR-012)
  - add client-side redirects from the old paths (`/candidates` → `/settings/candidates`, `/judge` → `/settings/judge`, `/personas` → `/settings/personas`, `/keys` → `/settings/keys`) so bookmarks / the MCP `open_dashboard` "needs setup" hints don't 404
  - final nav order: **Playground · Dashboard · Generations · Settings · Errors** (research.md R-004 — Errors stays top-level)

**Checkpoint**: The four config tabs collapse to one Settings tab with no loss of function. Every existing save/toggle/test action still works inside the shell. Old URLs redirect. Run quickstart.md T8.

---

## Phase 4: User Story 3 — Playground guides an unconfigured user (Priority: P2)

**Goal**: A first-time user who opens the dashboard before configuring anything sees a clear "not configured" state in the Playground (Run disabled, what's-missing message, deep-link into Settings), instead of hitting Run and failing blindly.

**Independent Test**: Wipe config, open `/`, observe the not-configured state + the Settings deep-link; click it and land on `/settings/candidates`. (quickstart.md, US3 acceptance.)

**Depends on**: US1 (T005 — the route that returns `needsConfig`) and US2 (T009 — the `/settings/*` deep-link targets must exist).

*No automated tests — the server-side `needsConfig` path is already covered by T002(b); this story is purely the client-side rendering of that response + an upfront config check.*

### Implementation for User Story 3

- [x] T010 [US3] Add the unconfigured/first-run UX to `ui/src/pages/Playground.tsx` (sequentially after T006 — same file):
  - **upfront detection only** (FR-013): on mount, fetch `GET /api/config` and disable Run when the structural gate would fail (<2 enabled candidates, or no enabled judge) — show what's missing with a deep-link button to `/settings/candidates`. (Key completeness isn't knowable client-side.)
  - Note: the **response** rendering of `needsConfig` (FR-014) is owned by T006 — do not re-implement it here. This task adds only the pre-Run gate check + the disabled-Run state.
  - depends on T005 (route returns `needsConfig`) + T009 (`/settings/*` routes exist)

**Checkpoint**: An unconfigured user is guided to Settings rather than failing blind. The gate failure renders as actionable amber, not red. All three user stories now independently functional.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validate the whole feature end-to-end and update release artifacts.

- [x] T011 [P] Add `[0.3.1]` changelog entries (Playground UI + Settings consolidation) following the existing changelog convention (see the `docs(008): fold feature 008 changelog entries` commit pattern) in `CHANGELOG.md`
- [x] T012 Run the full `quickstart.md` validation (T1–T8 automated + manual, then E1 parity check: same prompt via Playground vs MCP client → byte-identical `activities` shape, only `persona_source` differs — SC-002); fix any issues found
- [x] T013 Full `pnpm typecheck` + `pnpm test` green on the completed feature; confirm no new entries in `ui/package.json` or root `package.json` dependencies (SC-006 — no new runtime deps)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **US1 (Phase 2, MVP)**: Depends on Setup. Self-contained — adds the route + the page + the nav entry.
- **US2 (Phase 3)**: Depends on Setup. **Parallelizable with US1's leaf tasks** (T008/Settings.tsx is disjoint from US1 files), BUT `ui/src/App.tsx` is shared: T007 (US1's Playground tab) and T009 (US2's Settings tab replacement) both edit the nav + routes — **sequence these two** (T007 first, then T009).
- **US3 (Phase 4)**: Depends on **US1** (T005 — `needsConfig` comes from the route) **and US2** (T009 — the `/settings/*` deep-link targets).
- **Polish (Phase 5)**: Depends on all three stories.

### Task Dependency Graph

```
T001 (baseline)
  └─→ T002 [US1 test, RED]        T008 [US2 Settings.tsx]
        └─(turned green by)─        └─→ T009 [US2 wire App.tsx]  ← sequenced after T007
            T005 [US1 route]                 │
              │                              │
   T003 [US1 api.ts] ──┐                     │
   T004 [US1 extract] ─┼─→ T006 [US1 Playground.tsx] ──→ T007 [US1 wire App.tsx]
                       │                                (Playground as first tab)
                       │                                      │
                       └──────────────────────────────────────┴─→ T010 [US3 unconfigured UX]
                                                                        (needs T005 + T009)
                                                                        │
                                                                  T011, T012, T013 (Polish)
```

### Within Each User Story

- Tests (where included) written FIRST and RED before implementation
- Server route before the UI that calls it
- Shared extraction (T004) before the page that imports it (T006)
- Page before the nav wiring that mounts it
- Story complete and independently testable before moving on

### Parallel Opportunities

- **T003, T004, T008** can all run in parallel — three different files, no mutual dependencies (T003 = `ui/src/api.ts`, T004 = `ui/src/components/FusionBreakdown.tsx` + `Generations.tsx` re-import, T008 = `ui/src/pages/Settings.tsx`)
- **T011** (changelog) can run in parallel with any late-stage task — independent file
- US1 and US2 can be developed concurrently by different agents **except** the two `App.tsx` wiring tasks (T007 then T009 — sequential)

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 — confirm baseline green
2. T002 — write the route tests (RED)
3. T003 + T004 (parallel) — api client method + FusionBreakdown extraction
4. T005 — implement the route (tests GREEN)
5. T006 — build the Playground page
6. T007 — wire the Playground as the first tab
7. **STOP and VALIDATE**: run quickstart.md T5–T7 — a user can fuse from the browser. This is a demoable MVP even though config is still in 4 tabs.

### Incremental Delivery

1. Setup → US1 → **validate** (MVP: browser fusion works)
2. US2 → **validate** (quickstart.md T8: Settings consolidation works)
3. US3 → **validate** (unconfigured users are guided)
4. Polish → full quickstart.md + E1 parity + suite green

### Suggested MVP Scope

**User Story 1 only** (T001–T007). It delivers the headline capability — running a fusion from the browser with zero MCP client setup — and activates feature 006's dormant `source:"ui"` path (SC-003). US2 (Settings reorg) and US3 (unconfigured UX) are valuable refinements but US1 is independently shippable and demoable.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks
- `[Story]` label maps each task to its user story for traceability
- The `source:"ui"` arg in T005 is **load-bearing** — it's the whole reason feature 006's persona-policy exemption exists; the test T002(e) verifies it fired (SC-003)
- The FusionBreakdown extraction (T004) is a refactor of helpers local to `Generations.tsx` — within AGENTS.md §3 (clean up your own mess; single source of truth). Generations.tsx behavior must not change.
- No new runtime dependencies (SC-006) — the Playground reuses `GenerationText`, textarea inputs, and the existing `/api/runtime` poll pattern
- Commit after each task or logical group; the existing commit-message convention applies (`feat(009): …`, `refactor(009): …`, `docs(009): …`)
