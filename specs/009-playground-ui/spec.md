# Feature Specification: Playground UI + Settings Consolidation

**Feature Branch**: `009-playground-ui`

**Created**: 2026-06-22

**Status**: Draft

**Input**: User description: "Add another tab to the UI. This should be the first tab. It is a typical Google-AI-Studio-like Playground UI for the users to use the MCP directly if they want (Playground is the MCP client). That means we also need to consolidate Candidates, Judge, Personas, API Keys into 1 tab called Settings, and inside the settings tabs we can have a left sidebar of each of these pages."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Run a fusion from the browser (Priority: P1)

A user wants to try OpenFusion without wiring up an MCP client. They open the dashboard, land on the **Playground** (the new first tab), type a prompt, optionally paste context and pick a persona, and hit **Run**. They watch the fan-out → analysis → synthesis progress live, then read the synthesized answer. The same run appears in Generations and Dashboard like any MCP-launched fusion.

**Why this priority**: This is the headline capability of the feature — the Playground is the entire reason for v0.3.1. It also activates the dormant `source:"ui"` persona-policy exemption (feature 006 had no UI callsite; this is it).

**Independent Test**: Configure ≥2 candidates + a judge + keys (via Settings), open Playground, run a prompt, observe a synthesized answer + the run in Generations. Fully exercisable without any MCP client.

**Acceptance Scenarios**:

1. **Given** OpenFusion is configured, **When** the user opens the dashboard root, **Then** the Playground tab is selected by default (it is the first tab and the `/` route redirects there or renders it).
2. **Given** the Playground is open and configured, **When** the user enters a prompt and clicks Run, **Then** a fusion starts and live progress (phase + candidate count) is shown within ~2s.
3. **Given** a fusion is running, **When** it completes successfully, **Then** the synthesized answer is rendered inline (markdown, with a copy button) and the run is visible in Generations with the same `activityId`.
4. **Given** a fusion completes with `status:"partial"` (some candidates failed), **Then** the answer still renders and the candidate breakdown shows which survivors contributed.
5. **Given** the user picked a persona override in the Playground, **Then** the resulting activity row records `persona_source = "active"` (UI calls are policy-exempt — the user is the picker), not `strict-enforced` or `override`.

---

### User Story 2 — Configure everything under one Settings tab (Priority: P1)

A user wants to manage candidates, the judge, personas, and API keys without hopping between four top-level tabs. They open **Settings** (the consolidated tab) and see a left sidebar listing the four sub-sections; picking one renders the existing page unchanged inside the shell.

**Why this priority**: The consolidation is the second explicit ask and is a prerequisite for the Playground's "needs setup" affordance to deep-link sensibly (it links into Settings → Candidates).

**Independent Test**: Open Settings, click each sidebar item, confirm each of the four existing pages (Candidates, Judge, Personas, API Keys) renders and is fully functional (save a candidate, flip a toggle, etc.) inside the shell.

**Acceptance Scenarios**:

1. **Given** the dashboard nav, **Then** there is exactly one **Settings** tab where four separate tabs (Candidates, Judge, Personas, API Keys) used to be.
2. **Given** the Settings tab is open, **Then** a left sidebar lists Candidates, Judge, Personas, API Keys, and the active sub-section is highlighted.
3. **Given** the user navigates to `/settings/candidates`, **Then** the existing `CandidatesPage` renders inside the shell and saving a candidate still persists (the `onChanged` → App refresh handshake is preserved).
4. **Given** the user is on `/settings/keys`, **Then** the existing `ApiKeysPage` renders and the test-provider button still works.

---

### User Story 3 — Playground guides an unconfigured user to Settings (Priority: P2)

A first-time user opens the dashboard before configuring anything. The Playground shows a clear "not configured" state with a button that deep-links into Settings → Candidates, instead of letting them hit Run and fail blindly.

**Why this priority**: Necessary for a good first-run experience, but it builds on US1 + US2. The gate itself is enforced by `runFusion` (Constitution VI); the UI just surfaces `needsConfig` gracefully.

**Independent Test**: Wipe config, open Playground, observe the not-configured state + the Settings deep-link; click it and land on Settings → Candidates.

**Acceptance Scenarios**:

1. **Given** OpenFusion is not configured (<2 candidates, or no judge, or missing keys), **When** the user opens the Playground, **Then** the Run button is disabled and a message explains what's missing with a link to Settings.
2. **Given** the user clicks the link, **Then** they land on `/settings/candidates` (or whichever section resolves the first missing requirement).
3. **Given** the user then runs a fusion from the Playground that fails the gate, **Then** the error is shown with `needsConfig` styling (amber, actionable) — not a red runtime error.

---

### Edge Cases

- **A Playground fusion is still in flight when the user clicks Run again.** The Run button is disabled while a fusion is running for that browser session (client-side guard). The engine itself does not serialize UI fusions — a second client could start a concurrent one (single-user local tool; concurrent UI runs are tolerable per Constitution VII, same as the known event-loop-blocking limitation).
- **The user closes the tab mid-fusion.** The fusion continues server-side to completion (no `AbortController` — same known limitation as features 005/008 for the Tasks path); the `activities` row resolves to its terminal status and shows up in Generations/Dashboard. Reopening the Playground does not auto-reattach (out of scope — YAGNI).
- **The browser poll misses the brief running window.** The Playground falls back to fetching `/api/activity/:id` by the `activityId` returned at kickoff; the row always exists (allocated before fan-out) and resolves to a terminal status. No stuck "running" in the UI.
- **Persona picker shows personas that need setup.** The picker is populated from `GET /api/personas` (existing); if the user has deleted all custom personas the builtins still appear (existing `withBuiltins` merge in `server/api/personas.ts`).
- **Settings deep-link target page is itself broken.** Not possible — the four pages are rendered unchanged; only their *container* route changes.

## Requirements *(mandatory)*

### Functional Requirements

**Playground (US1)**

- **FR-001**: The dashboard MUST render a **Playground** tab as the first (leftmost) tab, and it MUST be the default landing (`/` renders the Playground).
- **FR-002**: The Playground MUST accept a `prompt` (required), an optional `context` (multi-line), and an optional `persona` override (dropdown populated from `GET /api/personas`).
- **FR-003**: A new `POST /api/fusion` route MUST accept `{ prompt, context?, persona? }`, call `runFusion({ …, source:"ui", db })`, and return `{ activityId, ok, status, answer?, error?, needsConfig? }`.
- **FR-004**: The route MUST pass `source:"ui"` so the fusion is persona-policy-exempt and records `persona_source = "active"` (activates feature 006's dormant UI exemption).
- **FR-005**: The route MUST NOT accept or echo API keys; key resolution is server-side via `getKey()` exactly as the MCP tool does (Constitution IV).
- **FR-006**: After kickoff, the Playground MUST show live progress by polling `GET /api/runtime` (the existing endpoint) at ~2s, paused when the tab is hidden — mirroring the Dashboard `ServerStatus` widget.
- **FR-007**: On completion, the Playground MUST render the synthesized answer via the existing `GenerationText` component (markdown + copy) and show per-candidate + judge breakdowns reusing the `Generations.tsx` patterns (`CandidatesView`, `JudgeView`, `SubCallStats`).
- **FR-008**: A Playground fusion MUST be logged identically to an MCP fusion (one `activities` row + N+2 `sub_calls`) because it is the same `runFusion` call — it MUST appear in Dashboard / Generations / Errors / Stats without special-casing.

**Settings consolidation (US2)**

- **FR-009**: The four top-level tabs Candidates, Judge, Personas, API Keys MUST be replaced by a single **Settings** tab.
- **FR-010**: The Settings tab MUST render a left sidebar listing the four sub-sections, with the active one highlighted, and the selected page rendered in the main pane.
- **FR-011**: The four existing page components (`CandidatesPage`, `JudgePage`, `PersonasPage`, `ApiKeysPage`) MUST render unchanged inside the Settings shell — their props/`onChanged` contracts with `App.tsx` are preserved (no behavior change).
- **FR-012**: Direct URLs (`/settings/candidates`, `/settings/judge`, `/settings/personas`, `/settings/keys`) MUST work (deep-linkable).

**Unconfigured / first-run (US3)**

- **FR-013**: When the system is not configured, the Playground MUST disable Run and show what's missing, with a link to the relevant Settings sub-section.
- **FR-014**: A Playground fusion that fails the gate (`needsConfig:true`) MUST render as an actionable amber state, not a red runtime error.

### Key Entities *(include if feature involves data)*

- **Playground fusion request** — `{ prompt: string, context?: string, persona?: string }`. No new persistent entity; the result is the existing `Activity` (+ `sub_calls`).
- **Playground fusion response** — `{ activityId, ok, status, answer?, error?, needsConfig? }`. A thin projection of `FusionResult` + the `activityId` (which is on `FusionResult` already).
- **Settings sub-section** — one of `candidates | judge | personas | keys`; a route segment, not an entity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can run a fusion end-to-end from the browser with zero MCP client setup (open dashboard → type prompt → Run → read answer) — the core value proposition of v0.3.1.
- **SC-002**: A Playground-launched fusion is byte-identical in its durable record to an MCP-launched fusion (same `activities` + `sub_calls` columns; shows in Generations without a code change) — proves the Playground reuses `runFusion` rather than duplicating it.
- **SC-003**: The persona-policy exemption is observable: a Playground fusion with an active strict policy + a requested persona records `persona_source = "active"` (not `strict-enforced`) — proves feature 006's dormant `source:"ui"` path is now exercised.
- **SC-004**: The four config tabs collapse to one Settings tab with no loss of function — every existing save/toggle/test action on Candidates/Judge/Personas/ApiKeys still works inside the shell.
- **SC-005**: The top-level nav shrinks from 7 tabs to 5 (Playground, Dashboard, Generations, Settings, Errors — see research.md R-004) — less nav clutter, Playground foregrounded.
- **SC-006**: No new runtime dependency is added to `ui/package.json` or the server `package.json` (YAGNI — Constitution VII).

## Assumptions

- The Playground is a **single-user, local** tool (Constitution VII); concurrent UI fusions are tolerated but not engineered for (same stance as the known event-loop-blocking limitation).
- The existing poll-based progress pattern (Dashboard `ServerStatus`, 2s interval on `/api/runtime`) is sufficient for v1 — **no SSE/WebSocket** is introduced. A richer streaming UX is a possible later feature.
- The existing hand-rolled `GenerationText` markdown renderer is "good enough" for the synthesized answer and candidate outputs; **no `react-markdown` / highlighter dependency** is added in v1.
- The four consolidated pages are rendered **unchanged** inside the Settings shell — only their container route and the nav change. This keeps the diff small and avoids touching working code (AGENTS.md §3, surgical).
- "Google AI Studio-like" is interpreted at the UX level (prompt box, optional context, persona/system selector, Run button, result panel with model breakdowns) — not as a mandate to clone its exact layout or its streaming token-by-token rendering.
- Errors tab handling: see research.md R-004 (whether Errors stays a top-level tab or folds into Settings is a scope decision resolved there).
