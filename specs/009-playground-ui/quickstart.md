# Quickstart — 009-playground-ui

A runnable validation guide for the feature. Walk through T1–T8 to prove the Playground works end-to-end; E1 is the manual cross-check against the existing MCP path. This is a *validation guide* — implementation steps live in `tasks.md` (Phase 2).

## Prerequisites

- Node ≥ 22.19, pnpm installed.
- OpenFusion dev environment bootable: `pnpm dev` (boots MCP stdio + UI on `127.0.0.1:9077`).
- A working OpenFusion config: ≥2 enabled candidates, ≥1 enabled judge, and an API key for every referenced provider. (If you don't have one, `pnpm dev` then open `http://localhost:9077/settings/candidates` and set it up — which is itself a test of FR-009/FR-011.)

## Build commands

```bash
pnpm install
pnpm typecheck     # tsc --noEmit (server + UI)
pnpm test          # vitest run — includes the new tests/playground-api.test.ts
pnpm --filter ./ui run build   # build the React UI
pnpm build         # full build (tsc + UI + copy to ui-dist)
pnpm dev           # run the server (MCP stdio + Express UI on :9077)
```

In dev you can also run the UI's Vite dev server separately (`pnpm --filter ./ui run dev`, port 5173, proxies `/api` → `:9077`) for hot-reload, but the production path is `pnpm dev` + the built bundle.

---

## T1 — `POST /api/fusion` runs a fusion server-side (automated)

**Setup**: a temp DB + `registerFauxProvider()` (the pattern used by `tests/fusion.test.ts`).

**Run**: `pnpm test -- playground-api`.

**Expected**: the test posts a valid `{ prompt }` against a configured faux DB and asserts:
- response `ok:true`, `status:"success"` (or `"partial"`), `answer` is a non-empty string;
- `activityId` is present and matches a row in the `activities` table;
- that row has `persona_source = "active"` (proves `source:"ui"` fired — SC-003).

## T2 — `POST /api/fusion` returns `needsConfig` when unconfigured (automated)

**Run**: same test file.

**Expected**: with an empty config (<2 candidates), the response is `{ ok:false, status:"error", needsConfig:true }`, **no `activityId`**, and the error message names the missing requirement. No `activities` row is written (the gate ran first).

## T3 — `POST /api/fusion` 400s on a missing prompt (automated)

**Run**: same test file.

**Expected**: `POST /api/fusion` with `{}` or `{ prompt:"" }` returns 400 `{ error:"BAD_REQUEST", detail:/prompt is required/ }`. The uniform error envelope handles this (`ui-server.ts:33-40`).

## T4 — `POST /api/fusion` rejects no key material (automated)

**Run**: same test file.

**Expected**: a body `{ prompt:"x", apiKey:"sk-…" }` is accepted (the unknown field is ignored), runs normally, and the response contains **no** key fields. (Constitution IV — keys never leave `secrets.enc`.)

## T5 — Playground tab is the first tab + default route (manual)

**Setup**: `pnpm dev`, open `http://localhost:9077`.

**Expected**:
- The header nav reads (left→right): **Playground · Dashboard · Generations · Settings · Errors**.
- **Playground** is highlighted (active) on `/` — FR-001.
- Visiting `/playground` directly also works.

## T6 — Run a fusion from the Playground (manual, end-to-end)

**Setup**: configured OpenFusion (prerequisites).

**Steps**:
1. On the Playground, type a prompt, optionally add context + pick a persona.
2. Click **Run**.

**Expected** (FR-002, FR-006, FR-007):
- The Run button disables; a progress indicator appears within ~2s showing the phase (fan-out → analysis → synthesis) and candidate count, fed by `/api/runtime`.
- On completion the synthesized answer renders (markdown, copy button).
- A collapsible "Candidate responses & judge analysis" section is present; expanding it shows the per-candidate outputs (dropdown to pick which worker) and the judge's structured analysis + the synthesis stats — same rendering as Generations.

## T7 — The Playground run shows up in Generations + Dashboard (manual)

**Immediately after T6**:

**Expected**:
- Open **Generations**: the most recent activity is the Playground run (same timestamp + prompt excerpt). Selecting it shows the same candidate/judge breakdown — SC-002 (durable record is identical).
- Open **Dashboard**: the KPIs + the recent-activity table include the run; its cost/tokens/latency rolled up like any MCP fusion.
- (If any candidate failed and `status:"partial"`:) Open **Errors**: the run appears with the partial-survivor detail — proving no special-casing (FR-008).

## T8 — Settings consolidation works (manual)

**Steps**:
1. Click **Settings** in the nav.

**Expected** (FR-009, FR-010, FR-011, FR-012):
- A left sidebar lists Candidates, Judge, Personas, API Keys; the active one is highlighted; `/settings` defaults to `/settings/candidates`.
- Clicking each renders the **existing** page unchanged inside the shell.
- Saving a candidate (Candidates), flipping a toggle (Judge), creating/editing a persona (Personas), and testing a provider (API Keys) all still work — the `config`/`onChanged` handshake with `App.tsx` is preserved.
- Direct URLs `/settings/candidates`, `/settings/judge`, `/settings/personas`, `/settings/keys` each land on the right sub-section.
- Old URLs `/candidates`, `/judge`, `/personas`, `/keys` redirect to their new `/settings/*` homes (no 404 on bookmarks).

---

## E1 — Manual parity check: Playground vs MCP fusion (SC-002)

The headline success criterion. Proves the Playground reuses `runFusion` rather than duplicating it.

**Steps**:
1. Run the **same prompt** twice — once from the Playground, once via an MCP client (`claude`/ZCode/codex with the `fusion` tool, or `openfusion` CLI).
2. Open both runs in **Generations**, side by side.

**Expected**: the two `activities` rows have the **same shape** — same columns populated, same `sub_calls` structure (N workers + judge_analysis + judge_synthesis), same `generated_text`/`analysis_json` capture. The only systematic difference is `persona_source`: the Playground run reads `"active"` (UI exemption, SC-003) while the MCP run reads whatever the policy dictated (`active`/`override`/`strict-enforced`).

**Fail condition**: any structural difference in the rows (missing field, different status mapping, absent sub_call) means the Playground diverged from `runFusion` — a bug.

---

## Out of scope for v1 (don't validate — not implemented)

- Token-by-token streaming (research.md R-002/R-003 — the answer lands atomically at synthesis).
- Reattaching to an in-flight fusion after closing/reopening the tab (research.md R-003 — YAGNI).
- Cancellation (known limitation across features 005/008/009 — no `AbortController`).
- A code editor / syntax highlighter for the prompt box (research.md R-005 — YAGNI).
- Multi-user concurrency hardening (Constitution VII — single-user local).
