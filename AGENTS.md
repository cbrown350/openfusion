# Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Architecture

Full architectural reference: `ARCHITECTURE.md` in the project root.

## Layers

```
Adapters (stdio MCP tool + Express UI on :9077)
  → Core (fusion engine: fan-out + two-step judge)
    → Provider layer (@earendil-works/pi-ai)
      → Persistence (SQLite + AES-256-GCM encrypted secrets)
```

One Node process. The MCP server speaks JSON-RPC over stdio; the Express server serves the React dashboard + REST API on `127.0.0.1:9077`. Both share the same in-memory config/activity state, backed by on-disk SQLite + encrypted secrets.

## Key Files

| Concern | File | Notes |
|---------|------|-------|
| MCP entry | `src/index.ts` | Shebang; boots McpServer (stdio) + UI server |
| MCP server | `src/server/mcp-server.ts` | Registers `fusion` + `open_dashboard` tools, progress notifications |
| UI server | `src/server/ui-server.ts` | Express on :9077, static UI + REST API |
| Fusion engine | `src/fusion/fusion.ts` | Orchestrate fan-out → judge step 1 → judge step 2 |
| Worker | `src/fusion/worker.ts` | Single-shot candidate call via pi-ai |
| Judge | `src/fusion/judge.ts` | 2-step: analysis tool-call, then synthesis |
| Provider bridge | `src/providers/pi-ai-bridge.ts` | `getModel` + `complete`, injects `apiKey` per call; `listProviders`/`listModels` merge pi-ai's catalog with `custom-providers.ts` |
| Custom providers | `src/providers/custom-providers.ts` | `rapid-mlx` (keyless) + `ollama-cloud` (keyed); OpenAI-compatible; `discoverModels()` fetches live `/v1/models` |
| Config store | `src/config/store.ts` | Read/write `config.json` + `secrets.enc` |
| Crypto | `src/config/crypto.ts` | AES-256-GCM, machine-bound `master.key` |
| DB | `src/store/db.ts` | better-sqlite3, WAL mode, migrations |
| Activity log | `src/store/activity.ts` | One `activities` row + N+2 `sub_calls` rows per fusion |
| Stats | `src/store/stats.ts` | Aggregation queries (activity as a dimension) |

## The `fusion` Tool

Single-shot fan-out → two-step judge. NOT an agent: workers get no tools; the caller supplies `prompt` + optional `context`. Flow:

1. **Config gate** — refuse until ≥2 candidates + judge + all referenced provider keys configured.
2. **Fan out** — `Promise.allSettled`, per-worker timeout (default 120s).
3. **Survive** — proceed if ≥2 candidates succeed; otherwise error.
4. **Judge step 1** — structured analysis (consensus / contradictions / partial coverage / unique insights / blind spots) via a pi-ai tool call.
5. **Judge step 2** — synthesis from candidates + analysis only (no new external info).
6. **Log** — `activities` + `sub_calls` rows.
7. **Return** — final answer text.

Both judge steps use the **same** provider/model combo.

**Task-capable (MCP Tasks / SEP-1686).** Registered via `server.experimental.tasks.registerToolTask` with `taskSupport: 'optional'`. On a Tasks-aware client the `tools/call` returns a `CreateTaskResult` immediately and the fusion runs detached in the same process (`src/fusion/task-runner.ts`); the client fetches the result via `tasks/get` + `tasks/result`. On a non-Tasks client the SDK auto-polls and returns the final `CallToolResult` (blocking, unchanged from pre-task behavior). Fusion semantics are identical on both paths — only *when* `tools/call` returns differs. Design and wiring details in `specs/005-mcp-tasks-sep/`.

**Persona discovery + policy (feature 006).** Two additional MCP tools + a config-gated override path:
- `list_personas` — read-only discovery; returns `[{id, name, description, builtin, active}]` (no prompt text). Never gated by policy.
- `fusion`'s optional `persona` arg — agents discover via `list_personas`, then pass `persona:<id>`. Resolution is audited on `activities.persona_source` (`active` | `override` | `strict-enforced` | `invalid-fallback`).
- `config.settings.personaPolicy` (`strict` | `allow-override`, default `allow-override`) — gates MCP-client overrides only (UI fusions exempt via `FusionInput.source:"ui"`). Strict = warn + continue (never block): the active persona runs, a `notifications/message` warning fires, and if the client advertises `elicitation.form` the user is asked once per session to relax (`SessionOverrideState` dedupes concurrent callers). Invalid ids never error — they fall back to active with `persona_source="invalid-fallback"`. Enforcement lives in `runFusion` (single site, both entry paths). Details in `specs/006-persona-discovery/`.

**Sequential fan-out (feature 007).** `config.settings.executionMode` (`parallel` default | `sequential`) governs candidate scheduling. Parallel is the unchanged `Promise.all` fan-out (optimal for cloud). Sequential runs candidates **one at a time** in slot order — an opt-in for low-VRAM local setups (Ollama/llama.cpp) where simultaneous model loads OOM. A serial time budget (`computeSerialBudgetMs = 3min × N + 6min`, `src/fusion/fanout.ts`) gates *launching* the next candidate (never aborts the in-flight one — no `AbortController`); on exhaustion the run proceeds with survivors so far (same ≥2 gate). The per-worker timeout + 3-retry machinery is identical in both modes. Dispatch lives in `runFusion` (single site, both entry paths). A live status surface (`GET /api/runtime` — distinct from `/api/status`; `src/fusion/status.ts` registry, `enter`/`update`/`finally leave` in `runFusion`) feeds a Dashboard widget. Details in `specs/007-sequential-processing/`.
**Async fusion results via deferred retrieval (feature 008).** The `fusion` tool's optional `_resume_from` arg gives non-Tasks clients (codex/ZCode, which hardcode `task:None`) a deferred-result protocol: a kickoff `fusion({prompt})` returns immediately (~1s) with a `processing` shape carrying a `reference_id`, and the agent retrieves via `fusion({_resume_from: "<id>"})`. Parallel retrievals bounded-long-poll (~45s, under the ~60s codex per-call ceiling — research R-001 VERIFIED) and return the synthesized answer when the fusion lands; sequential retrievals are ETA-guided (immediate return with a refined remaining ETA + dashboard link). The result is byte-identical to the blocking path (SC-006) and to feature 005's Tasks path (FR-015). Durable from kickoff in a new `fusion_jobs` SQLite table (`activity_id` = the reference id = the `activities.id`, identity collapse); live candidate-progress stays ephemeral. A startup sweep reclassifies orphaned `processing` rows from a previous process as `interrupted` (FR-009); a stalled circuit reclassifies rows with stale `last_progress_at` as `error/stalled` (FR-012); a write-late guard extends `expires_at` for processing rows near eviction so a late completion stores rather than lands expired (FR-011). `FusionResult.errorKind` (`no-survivors` | `judge-failed` | `internal`) flows structurally to `fusion_jobs.error_kind` (FR-014). Details in `specs/008-async-fusion-results/`.
**⚠️ SDK handler override (feature 008, load-bearing).** The deferred-result protocol requires intercepting non-Tasks `tools/call` to the fusion tool BEFORE the SDK's `handleAutomaticTaskPolling` blocks (that blocking poll IS the codex/ZCode timeout bug 008 exists to fix). `src/fusion/resume-dispatch.ts` replaces the SDK's installed `CallToolRequest` handler post-registration: it captures the SDK's handler, installs a wrapper that routes non-Tasks fusion calls to the kickoff/retrieval branches, and delegates Tasks clients + all other tools to the captured handler unchanged (FR-013 preserved by delegation, not reimplementation). This reaches into `server.server._requestHandlers.get("tools/call")` — a documented, deliberate SDK coupling. **On `@modelcontextprotocol/sdk` upgrade, verify** (see `resume-dispatch.ts` header + the dispatch canary test in `tests/resume-parallel.test.ts`): (1) the CallToolRequest handler is still installed eagerly at first-tool registration; (2) the handler key is still `"tools/call"`; (3) `request.params.task` still discriminates Tasks vs non-Tasks and the SDK still blocks non-Tasks via `handleAutomaticTaskPolling`. If the SDK removes the blocking path, the wrapper becomes a no-op pass-through and can be deleted.
**Known limitations (v1, documented):**
- **Tasks are non-durable (005 path only).** `InMemoryTaskStore` + a module-level `Map<taskId, activityId>` live in-process; a restart loses in-flight Tasks-path tasks. The SQLite `activities` row is the durable record (may be left at `status='running'` on crash). Task IDs are ephemeral — clients must not persist them across sessions. NOTE: feature 008's `_resume_from` path IS durable (`fusion_jobs` table) and survives restarts via the startup sweep; the non-durability above applies only to the Tasks-path `tasks/result` retrieval, not to `_resume_from`.
- **Event-loop blocking under concurrent load.** `better-sqlite3` is synchronous; a long fusion can delay a second client's calls and the Express dashboard. Tolerable for a single-user local tool (Constitution VII); revisit if multi-user.
- **No cancellation wiring.** SEP-1686 `tasks/cancel` is not implemented; `runFusion` has no `AbortController`, so a cancelled fusion runs to completion. Scoped as a possible v1.1 addition.
- **Sequential mode ≠ local-server VRAM management.** `executionMode:"sequential"` removes OpenFusion's *own* candidate concurrency; it does not manage the local model server's VRAM (Ollama `keep_alive`, llama.cpp offloading). A user can still OOM if their local server keeps models resident. Documented, not engineered.
- **Feature 008's SDK handler override is version-coupled.** The `_resume_from` deferred-result protocol depends on replacing the SDK's `CallToolRequest` handler (see the SDK handler override note above + `src/fusion/resume-dispatch.ts` header). An `@modelcontextprotocol/sdk` upgrade that changes the handler's install timing, key, or the blocking-auto-poll behavior can silently disable the `_resume_from` path (non-Tasks clients fall back to the pre-008 blocking behavior). A dispatch canary test (`tests/resume-parallel.test.ts`) catches shape changes at test time.

## Conventions

- **pnpm, not npm** — use pnpm for all dependency installs.
- **TypeScript → ES2022, NodeNext modules** — plain `tsc` to `dist/`, no bundler. Dev via `tsx`.
- **stderr for logs** — `stdout` is the MCP JSON-RPC channel under stdio transport; any stray `console.log` corrupts the protocol. Use `console.error`.
- **One Node process** — stdio MCP transport + Express UI server coexist; stdio only owns stdin/stdout, the HTTP port is free.
- **Keys never leave `secrets.enc` unmasked** — never log secrets, never return them unmasked from any API.
- **Dashboard binds `127.0.0.1` only** — never `0.0.0.0`.
- **Vitest** for tests; use pi-ai `registerFauxProvider()` for deterministic fusion tests.
- **Errors carry `code` + `retryable`** — machine-readable throughout.
- **Pin `@earendil-works/pi-ai` exactly** — it's pre-1.0; `save-exact`. Do NOT use the deprecated `@mariozechner/pi-ai`.

<!-- SPECKIT START -->
Active feature: **009-playground-ui** (Playground UI + Settings Consolidation).
Stage: implemented (T001–T013 complete, 176 tests green); quickstart E1 (manual parity check vs MCP client) deferred as manual validation.

Working documents (read in order before extending):
- Tasks: specs/009-playground-ui/tasks.md (T001–T013 all [x], organized by user story)
- Plan: specs/009-playground-ui/plan.md (tech context, constitution gate ✅ all 7 principles pass, project structure)
- Spec: specs/009-playground-ui/spec.md (3 user stories US1–US3, FR-001..014, SC-001..006)
- Design depth: specs/009-playground-ui/research.md (R-001..R-007 — execution path, progress UX, source:ui
    activation, settings nav, persona picker, error UX, scope cuts),
  data-model.md (NO new tables — Playground fusion = runFusion; persona_source:"active" is the UI signal; SC-003),
  contracts/playground-api.md (POST /api/fusion request/response + SPA route map),
  quickstart.md (T1–T8 automated+manual, E1 parity check vs MCP path)

Shipped: **Playground** tab (new first/default) — Google-AI-Studio-style MCP-client UI running fusions directly
from the browser via `POST /api/fusion` → `runFusion({ source:"ui" })`. Activates feature 006's dormant
persona-policy exemption (SC-003 verified by `tests/playground-api.test.ts`(e)). A Playground fusion is
byte-identical in its durable record to an MCP fusion (SC-002). The four config tabs (Candidates/Judge/
Personas/API Keys) consolidated into one **Settings** tab with a left sidebar; old URLs redirect. Errors stays
top-level. Nav: Playground · Dashboard · Settings · Errors (the Generations tab was folded into the
Playground's history rail + breakdown post-spec). No new persistence, no new runtime
dependencies (SC-006). `FusionBreakdown.tsx` is the shared breakdown component (single source of truth).

Key decisions: add a **Playground** tab as the new first/default tab — a Google-AI-Studio-style MCP-client
UI letting a user run a fusion directly from the browser (prompt + optional context + optional persona
override → Run → live progress → synthesized answer + candidate/judge breakdown). The Playground calls
`runFusion()` **directly** from a new `POST /api/fusion` Express route with `FusionInput.source = "ui"`
(R-001) — NOT via the MCP stdio tool, the 005 Tasks path, or the 008 `_resume_from` durable path.
`source:"ui"` activates feature 006's **dormant** persona-policy exemption (spec 006 tasks.md T014 flagged
"no UI callsite exists today" — this is it): even under `strict`, a user-selected override runs and the
activity row records `persona_source = "active"` (SC-003). A Playground fusion is byte-identical in its
durable record to an MCP fusion — same `activities` + N+2 `sub_calls` rows, appears in
Dashboard/Errors/Stats with zero special-casing (SC-002). **No new persistence, no new runtime
dependency** (YAGNI — reuses `GenerationText` (react-markdown + remark-gfm) + the shared `FusionProgress`/
`PhaseBar` (extracted from the Dashboard's `ServerStatus` widget) + the existing `/api/runtime`
poll pattern; R-002/R-005). Progress is short-poll
`/api/runtime` @ ~2s (no SSE/WebSocket). In the same pass: **consolidate Candidates/Judge/Personas/API
Keys into one Settings tab** with a left sidebar; the four existing page components render unchanged
inside the shell (surgical — only the nav + a thin `Settings.tsx` shell change). Errors stays top-level
(R-004). Nav: Playground · Dashboard · Settings · Errors. Constitution gate PASS — the
Playground is a *client* of `runFusion`, not a modification of it (Principle I preserved).
<!-- SPECKIT END -->
