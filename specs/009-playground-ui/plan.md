# Implementation Plan: 009-playground-ui

**Branch**: `009-playground-ui` (off `v0.3.1-upgrade` ← `main`) | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-playground-ui/spec.md`

## Summary

Add a **Playground** tab as the new first/leftmost tab in the OpenFusion dashboard: a Google-AI-Studio-style MCP client UI that lets a user run a fusion directly from the browser — write a prompt (+ optional context, + optional persona override), hit Run, watch live fan-out/judge progress, and read the synthesized answer plus the per-candidate and judge breakdowns inline. In the same pass, **consolidate the four configuration tabs (Candidates, Judge, Personas, API Keys) into a single Settings tab** with a left sidebar of sub-sections, leaving Dashboard, Playground, Generations, and Errors as top-level tabs.

This is the first UI surface that *launches* a fusion rather than only reading past ones. It calls `runFusion()` directly from a new Express route with `FusionInput.source = "ui"` — which activates the **dormant persona-policy exemption** that feature 006 modeled but had no callsite for (spec 006 tasks.md T014 explicitly flagged this gap). No new persistence: a Playground fusion is logged identically to an MCP fusion (one `activities` row + N+2 `sub_calls`), and live progress reuses the existing `fusionStatusRegistry` + `GET /api/runtime` poll that the Dashboard already consumes.

## Technical Context

**Language/Version**: TypeScript 5.7 (ES2022, NodeNext, ESM). React 19.2 + Vite 8 for the UI.

**Primary Dependencies**:
- Server (existing, unchanged): `express` 5.2, `@earendil-works/pi-ai` 0.79.4 (pinned), `better-sqlite3` 12.10.
- UI (existing): `react` 19.2, `react-dom` 19.2, `react-router-dom` 7.17, `recharts` 3.8, Tailwind 4.3 (via `@tailwindcss/vite`, CSS-first — no `tailwind.config.js`).
- UI (new — see research.md R-005): none. The Playground reuses the existing hand-rolled `GenerationText` markdown renderer + `SubCallStats` chip row; no syntax highlighter / code editor / SSE client is introduced. The prompt + context inputs are plain `<textarea className="field">`, matching `Personas.tsx`'s PromptField. **YAGNI (Constitution VII)** — a richer editor is a later feature.

**Storage**: No schema changes. Playground fusions write to the existing `activities` + `sub_calls` tables via `runFusion` (same code path as the MCP tool). Live progress is ephemeral (the in-process `fusionStatusRegistry`, already polled by the Dashboard).

**Testing**: Vitest. Server-side: a new `tests/playground-api.test.ts` exercises the `POST /api/fusion` route against a temp DB + `registerFauxProvider()` (the established deterministic-fusion pattern). The UI is not unit-tested today and this feature does not add a UI test harness (surgical — matches existing scope).

**Target Platform**: Local single-user tool. Browser → `http://localhost:9077` (Express, `127.0.0.1` only — Constitution IV). The Playground is same-origin; no CORS, no new port.

**Project Type**: Existing web-service + React SPA (one Node process: stdio MCP + Express UI). This feature extends the existing project; it does not change its type.

**Performance Goals**: A Playground run is a normal fusion (parallel default; ~the user's configured `workerTimeoutMs` budget). The browser never blocks on a single long request: the route either (a) returns immediately with an `activityId` + the client polls `/api/runtime` + `/api/activity/:id` (chosen — see research.md R-002), or (b) holds the connection. **Decision: poll-based**, identical to the Dashboard's existing `ServerStatus` widget (2s interval, paused when hidden). No SSE/WebSocket introduced.

**Constraints**:
- Must bind `127.0.0.1` only (Constitution IV). Unchanged.
- `stdout` stays clean (it's the MCP JSON-RPC channel); the new route logs to stderr like every other route. Unchanged.
- Keys never leave `secrets.enc` unmasked. The Playground sends only `prompt`/`context`/`persona`; the server resolves keys server-side exactly as the MCP tool does. The response carries no key material.
- Event-loop blocking under concurrent load (known limitation, feature 008 notes): a Playground fusion is synchronous `better-sqlite3` work in the same process; tolerable for single-user (Constitution VII).

**Scale/Scope**: Single user, local. The Playground is one new page + one new route + one nav restructure. No multi-user concerns.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Fusion Engine, Not Agent (NON-NEGOTIABLE) | ✅ Pass | The Playground is a **client** of the fusion engine, not part of it. It sends `prompt` + `context` + optional `persona` and receives a synthesized answer. No tool loops, no agentic behavior is added — `runFusion` is unchanged. The UI gathers the prompt the same way an MCP client would. |
| II | Two-Step Judging | ✅ Pass | Unchanged. The Playground calls `runFusion`, which runs analysis → synthesis on the same judge. The UI only *displays* the two steps (reusing `Generations.tsx`'s `JudgeView` pattern); it never collapses them. |
| III | Resilient by Default | ✅ Pass | Unchanged. `runFusion`'s `Promise.allSettled` fan-out, per-worker timeout, ≥2 survivor gate, and sequential-mode alternative all apply identically to a UI-launched fusion. The Playground adds no new failure modes; a UI fusion that fails is logged with the same `status`/`errorKind`. |
| IV | Secrets Encrypted at Rest | ✅ Pass | No change to key handling. The Playground request body carries no keys; the server calls `getKey(provider, …)` server-side. UI stays `127.0.0.1`-bound. |
| V | Observable | ✅ Pass | A Playground fusion writes the **same** one-`activities`-plus-N+2-`sub_calls` rows (it's the same `runFusion` call). It shows up in Dashboard/Generations/Errors/Stats identically. No silent operations. |
| VI | Configuration Gated | ✅ Pass | `runFusion` enforces the gate (≥2 candidates, ≥1 judge, keys for referenced providers) before fan-out, regardless of caller. An unconfigured Playground run returns `needsConfig:true`; the UI shows the same "configure OpenFusion" affordance the MCP tool's `needsConfig` path uses, with a deep-link into the new Settings tab. |
| VII | Simple & Local | ✅ Pass | One Node process; pnpm; TypeScript → `tsc`; Vitest. **No new runtime dependency** (YAGNI — the existing `GenerationText` + textarea + poll pattern covers the v1 Playground). pnpm, not npm. |

**Gate result: PASS.** No NON-NEGOTIABLE violations. No Complexity Tracking entries needed. The feature is additive (one route, one page, one nav change) and reuses the engine unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/009-playground-ui/
├── plan.md              # This file
├── research.md          # Phase 0: R-001..R-007 (execution path, progress UX, source:ui activation, settings nav, persona picker, error UX, scope cuts)
├── data-model.md        # Phase 1: no new tables — documents the request/response shapes + identity with the MCP path
├── quickstart.md        # Phase 1: runnable validation (configure → run in Playground → see in Generations)
├── contracts/
│   └── playground-api.md  # Phase 1: POST /api/fusion request/response + progress polling contract
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Server — ONE new route file, ONE one-line mount in ui-server.ts
src/server/
├── ui-server.ts          # MODIFIED: mount fusionRouter() at /api/fusion (one line, after /api/personas)
└── api/
    └── fusion.ts         # NEW: POST /api/fusion — validates body, calls runFusion({source:"ui"}), returns {activityId, status, answer?, error?, needsConfig?}

# Fusion engine — UNCHANGED (the Playground is a client of runFusion, not a modification of it)
src/fusion/fusion.ts      # UNCHANGED: runFusion + FusionInput.source:"ui" already supported (feature 006)

# UI — ONE new page, ONE new settings shell, App.tsx nav restructure
ui/src/
├── App.tsx               # MODIFIED: nav order (Playground first, Settings replaces 4 tabs), routes add /playground + /settings/*
├── pages/
│   ├── Playground.tsx    # NEW: prompt+context+persona form, Run button, live progress (polls /api/runtime), result view (reuses GenerationText + SubCallStats + JudgeView patterns from Generations.tsx)
│   └── Settings.tsx      # NEW: shell with left sidebar (Candidates | Judge | Personas | API Keys) + <Outlet/>; the four existing page components render unchanged inside it
├── components/            # UNCHANGED (GenerationText reused by Playground; no new shared component)
└── api.ts                # MODIFIED: add runFusion({prompt, context?, persona?}) → POST /api/fusion; types for the response

# Tests
tests/
└── playground-api.test.ts  # NEW: POST /api/fusion against a temp DB + faux provider — asserts (1) source:"ui" path runs, (2) needsConfig when unconfigured, (3) response shape, (4) activities row written
```

**Structure Decision**: Single-project (the existing layout). The feature is one new Express route + one new React page + one nav restructure. No new directories beyond what the conventions already use (`src/server/api/` for routes, `ui/src/pages/` for pages, `tests/` for Vitest). The four consolidated pages (`Candidates`, `Judge`, `Personas`, `ApiKeys`) are **not moved or renamed** — `Settings.tsx` is a thin shell that renders them inside `<Outlet/>`, so existing imports and tests are untouched (surgical — AGENTS.md §3).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All seven principles pass. No violations to justify.
