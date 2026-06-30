# Data Model — 009-playground-ui

## No new persistent entities

**This feature introduces no new tables, no new columns, and no new files in the persistence layer.** A Playground fusion is a normal fusion: it flows through `runFusion()` (`src/fusion/fusion.ts`), which writes the *existing* rows. This section documents the shapes involved so the contract (`contracts/playground-api.md`) and tasks can reference them precisely.

---

## Request entity (ephemeral — request body only)

**`PlaygroundFusionRequest`** — the body of `POST /api/fusion`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | `string` | **yes** | The prompt to fuse across candidates. Non-empty after trim. |
| `context` | `string` | no | Optional background context / prior reasoning / tool results. Passed through to `runFusion.context`. |
| `persona` | `string` | no | Persona id or name override. Defaults to the active persona. Resolved via the existing `resolvePersonaWithPolicy({ source:"ui" })` path. |

**Validation**: 400 `BAD_REQUEST` if `prompt` is missing/empty after trim. Unknown fields are ignored (forward-compatible). The body size limit is the existing `express.json({ limit: "1mb" })` already installed in `ui-server.ts`.

**No secrets in the body** (Constitution IV). The route never accepts `apiKey`/`provider` fields; key resolution is server-side via `getKey(provider, secretsPath, keyPath)` exactly as `runFusion` already does.

---

## Response entity (the HTTP response)

**`PlaygroundFusionResponse`** — a thin projection of `FusionResult` (`src/fusion/fusion.ts:57-79`) plus the `activityId`.

| Field | Type | Always present? | Notes |
|-------|------|-----------------|-------|
| `activityId` | `string` | yes | The `activities.id` for this run (allocated before fan-out; `FusionResult.activityId`). Usable with `GET /api/activity/:id` and matched in `GET /api/runtime`. |
| `ok` | `boolean` | yes | Mirrors `FusionResult.ok`. |
| `status` | `"success" \| "partial" \| "error"` | yes | Mirrors `FusionResult.status`. |
| `answer` | `string` | only when `ok:true` | The synthesized answer. Omitted (not `null`) when `ok:false`. |
| `error` | `string` | only when `ok:false` | Human-readable reason. Omitted when `ok:true`. |
| `needsConfig` | `boolean` | only when `ok:false` & gate failed | `true` for a config-gate failure (route to Settings). Omitted otherwise. |

**`errorKind` is deliberately NOT surfaced in v1.** It exists on `FusionResult` for the 008 durable-path terminal handler; the Playground routes on `needsConfig` (→ amber setup state) vs `!ok` (→ red runtime error). If a later feature wants to distinguish "no-survivors" from "judge-failed" in the UI, the field is already on `FusionResult` and can be projected then. **YAGNI now.**

---

## What gets persisted (unchanged — same as every MCP fusion)

Because `POST /api/fusion` calls `runFusion({ source:"ui", db, … })` and `runFusion` is the single logging site, a Playground run writes:

- **One `activities` row** (`recordActivity`, `fusion.ts:178`) — with `persona_source = "active"` (because `source:"ui"` short-circuits the policy resolver). This is the **observable signal** that the UI exemption fired (SC-003).
- **N+2 `sub_calls` rows** (`recordSubCall`, `fusion.ts:242/304/327`) — one per worker (N), one `judge_analysis`, one `judge_synthesis`. Each carries provider/model/tokens/cost/latency/status + `generated_text`/`analysis_json` as applicable (Constitution V).

These rows are queryable by the **existing** endpoints with **no special-casing**:
- `GET /api/activity` (Dashboard, Generations list, Errors)
- `GET /api/activity/:id` (Generations detail, Playground breakdown)
- `GET /api/stats` (aggregates — Playground runs roll up like any other)
- `GET /api/runtime` (live progress — the registry `enter`/`update`/`leave` calls inside `runFusion` fire identically)

---

## Live-progress entity (ephemeral — unchanged, feature 007)

The Playground polls `GET /api/runtime`, which returns `FusionRuntimeStatus` (already defined in `ui/src/api.ts:115-118`):

```ts
interface FusionRuntimeStatus {
  state: "idle" | "in-progress" | "queued";
  fusions: ActiveFusion[];   // each: { activityId, mode, candidateCount, candidateIndex?, candidatesDone?, phase?, startedAt }
}
```

The Playground filters `fusions` by its own in-flight `activityId` to render its progress widget. No new shape.

---

## State transitions (the fusion state machine — unchanged)

Documented for reference; `runFusion` owns this and the Playground does not alter it:

```
POST /api/fusion received
  → runFusion gate check
      ✗ needsConfig → { ok:false, status:"error", needsConfig:true }   // FR-013/FR-014
      ✓ → recordActivity (status:"running") → enters /api/runtime
  → fan-out (parallel default | sequential) → /api/runtime updates (phase:"fan-out", candidatesDone rising)
      <2 survivors → { ok:false, status:"error", errorKind:"no-survivors" }
      ≥2 survivors →
  → judge step 1 (analysis) → /api/runtime phase:"analysis"
      ✗ → { ok:false, status:"error", errorKind:"judge-failed" }
  → judge step 2 (synthesis) → /api/runtime phase:"synthesis"
      ✗ → { ok:false, status:"error", errorKind:"judge-failed" }
      ✓ → updateActivity (status:"success" | "partial") → leaves /api/runtime
POST /api/fusion resolves → PlaygroundFusionResponse
```

The only state the Playground *adds* is client-side: `{ idle | running | done | error }` for its own Run button + progress widget. The server state machine is untouched.
