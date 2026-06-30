# Contract — `POST /api/fusion` (Playground API)

The single new REST endpoint introduced by feature 009. The Playground is the only intended caller, but the contract is general (a future CLI subcommand or integration could call it too).

**Same-origin only.** The UI server binds `127.0.0.1` (Constitution IV); this route inherits that. No CORS headers added.

---

## `POST /api/fusion`

Run a fusion from the browser. Blocks until the fusion completes (seconds-to-minutes); the client polls `GET /api/runtime` *in parallel* for live progress (see research.md R-002/R-003).

### Request

```
POST /api/fusion
Content-Type: application/json
```

**Body** — `PlaygroundFusionRequest`:

```jsonc
{
  "prompt": "Explain the tradeoffs between…",      // required, non-empty after trim
  "context": "Prior reasoning: …",                  // optional
  "persona": "researcher"                           // optional — id or name; defaults to active
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `prompt` | `string` | yes | 400 if missing / empty after `trim()`. |
| `context` | `string` | no | Omitted → `undefined` → no context passed to workers. |
| `persona` | `string` | no | Omitted → active persona. Invalid id/name → falls back to active (`persona_source:"active"`, same as the MCP path's `invalid-fallback` behavior under `source:"ui"`). |

The request body limit is the existing `express.json({ limit: "1mb" })` (`ui-server.ts:30`).

**No key material is accepted.** Fields named `apiKey`, `provider`, `secrets`, etc. are silently ignored — key resolution is server-side via `getKey()`. This is Constitution IV.

### Response

**200 OK** — `PlaygroundFusionResponse` (success or recoverable error; the route does not 4xx/5xx on a fusion *failure*, only on a malformed *request*):

```jsonc
// success / partial
{
  "activityId": "9b3f…",
  "ok": true,
  "status": "success",            // or "partial"
  "answer": "The synthesized answer…"
}

// gate failure (recoverable — route to Settings)
{
  "activityId": "9b3f…",          // present: the row is allocated before the gate? NO.
  "ok": false,
  "status": "error",
  "error": "OpenFusion isn't configured: need at least 2 enabled candidates…",
  "needsConfig": true
}

// runtime failure (no-survivors / judge-failed)
{
  "activityId": "9b3f…",
  "ok": false,
  "status": "error",
  "error": "Only 1 of 3 candidates succeeded (minimum 2 required)…"
}
```

> **`activityId` on gate failure**: the gate (`isConfigured`) runs *before* `recordActivity`, so a `needsConfig:true` response has **no** `activityId` (no row was written). The route omits the field in that case (not `null`). For every other `ok:false` path (no-survivors, judge-failed), `runFusion` *did* allocate the row, so `activityId` is present.

**400 Bad Request** — malformed body (uniform error envelope, already installed in `ui-server.ts:33-40`):

```json
{ "error": "BAD_REQUEST", "detail": "prompt is required" }
```

### Semantics

1. **Single source of truth.** The handler calls `runFusion({ prompt, context, persona, config: loadConfig(), db, source: "ui" })` — nothing else. `runFusion` owns the gate, fan-out, judging, logging, and live-status registry. The route is a *thin* caller (research.md R-001).
2. **Persona-policy-exempt.** `source:"ui"` activates feature 006's dormant UI exemption: even under `personaPolicy:"strict"`, a user-selected override runs and `activities.persona_source` reads `"active"` (FR-004, SC-003). No `onPersonaEvent` is wired.
3. **Identical durable record.** The row written is byte-identical in shape to an MCP fusion (same `activities` + `sub_calls` columns; FR-008, SC-002). It appears in Dashboard / Generations / Errors / Stats without special-casing.
4. **No new progress channel.** Live progress is the existing `GET /api/runtime` (feature 007); the handler does not stream. The client polls `/api/runtime` and matches on `activityId` (FR-006).

### Example — browser client

```ts
// ui/src/api.ts (addition)
export interface PlaygroundFusionResponse {
  activityId?: string;
  ok: boolean;
  status: "success" | "partial" | "error";
  answer?: string;
  error?: string;
  needsConfig?: boolean;
}
// …
runFusion: (body: { prompt: string; context?: string; persona?: string }) =>
  sendJSON<PlaygroundFusionResponse>("POST", "/api/fusion", body),
```

The `Playground.tsx` page calls `api.runFusion(…)`, and *while that promise is pending* runs a `setInterval` polling `api.getStatus()` (existing), filtering `fusions` by the `activityId` it got at kickoff. On resolve, it does one `api.getActivityDetail(activityId)` to fetch `sub_calls` for the breakdown view (research.md R-007).

---

## Routing changes (the other half of the contract — the SPA nav)

Not an HTTP contract, but the UI route map that replaces it:

| Before (v0.3.0) | After (v0.3.1) |
|------------------|----------------|
| `/` → Dashboard | `/` → **Playground** (FR-001) |
| `/dashboard` → Dashboard | `/dashboard` → Dashboard (unchanged) |
| `/candidates` → CandidatesPage | `/settings/candidates` → CandidatesPage (inside Settings shell) |
| `/judge` → JudgePage | `/settings/judge` → JudgePage (inside Settings shell) |
| `/personas` → PersonasPage | `/settings/personas` → PersonasPage (inside Settings shell) |
| `/keys` → ApiKeysPage | `/settings/keys` → ApiKeysPage (inside Settings shell) |
| `/generations` → GenerationsPage | `/generations` → GenerationsPage (unchanged) |
| `/errors` → ErrorsPage | `/errors` → ErrorsPage (unchanged — research.md R-004) |
| — | `/playground` → PlaygroundPage (explicit route in addition to `/`) |
| — | `/settings` → redirects to `/settings/candidates` |

**Nav order** (FR-009): Playground · Dashboard · Generations · Settings · Errors.

**Backward compatibility**: old `/candidates` etc. URLs should redirect (HTTP-level for the SPA catch-all is unnecessary — a client-side `<Route>` redirect suffices) so existing bookmarks / the MCP tool's `open_dashboard` "needs setup" hints don't 404. The App.tsx `<Route>` list includes redirect entries from the old paths to the new `/settings/*` paths.
