# Phase 0 Research — 009-playground-ui

Resolves the unknowns raised in the Technical Context + the design decisions the spec depends on. Each item states a **Decision**, **Rationale**, and **Alternatives considered**.

---

## R-001 — Does the Playground run `runFusion` directly in-process, or via the MCP tool / the 008 `_resume_from` durable path?

**Decision**: The Playground calls `runFusion()` **directly**, from a new `POST /api/fusion` Express route, in the same Node process as the UI server. It does **not** go through the MCP stdio tool, the Tasks path (005), or the `_resume_from` durable path (008).

**Rationale**:
- The UI server and the MCP server share one Node process (AGENTS.md architecture; `src/index.ts` boots both). The Express layer already has the `DB` handle and can import `runFusion` directly — no IPC, no stdio round-trip.
- `runFusion` is the **single enforcement site** for the gate, fan-out, judging, and logging (Constitution III/VI; feature 006 made it the single persona-policy site too). Calling it directly means a Playground fusion is *by construction* identical to an MCP fusion — same `activities` + `sub_calls` rows, same resilience, same gate. This is SC-002.
- The 008 `_resume_from` path solves a different problem (non-Tasks MCP clients that hardcode `task:None` and hit the SDK's blocking auto-poll). The browser is not such a client — it can poll freely. Reusing 008's durable machinery would add a `fusion_jobs` row + a bounded-long-poll protocol for no benefit (the browser already polls `/api/runtime`).
- The 005 Tasks path is MCP-transport-specific (`tasks/get`, `tasks/result`); irrelevant to a browser.

**Alternatives considered**:
- *Route the Playground through the MCP tool over an in-process transport.* Rejected — adds an unnecessary JSON-RPC hop; `runFusion` is already callable.
- *Reuse the 008 `_resume_from` kickoff → poll → retrieve flow for the browser too.* Rejected — it exists specifically to dodge the SDK's blocking auto-poll, which the browser doesn't use. Would double the surface area (a `fusion_jobs` row per Playground run) for zero gain.

---

## R-002 — How does the Playground get live progress: long-poll, SSE/WebSocket, or short-poll?

**Decision**: **Short-poll `GET /api/runtime` at ~2s**, paused when the tab is hidden — identical to the Dashboard's existing `ServerStatus` widget (`ui/src/pages/Dashboard.tsx`). The new `POST /api/fusion` returns immediately with `{ activityId, … }` and the client polls.

**Rationale**:
- `GET /api/runtime` already returns the in-process live-fusion snapshot (`fusionStatusRegistry.getSnapshot()` merged with DB `running` rows) — feature 007 built exactly this surface for the Dashboard widget. Reusing it is zero new server code for progress.
- The registry exposes `phase` ("fan-out" | "analysis" | "synthesis"), `candidateIndex`/`candidatesDone`, and `startedAt` — enough for a Google-AI-Studio-style progress indicator (phase chips + "X of N candidates responding").
- Polling is the established idiom in this codebase (Dashboard, visibility-paused). SSE/WebSocket would be a new primitive — the `api.ts` client only does `fetch`. **YAGNI (Constitution VII)** for a single-user local tool where a fusion takes seconds-to-minutes.
- The `POST /api/fusion` response itself does **not** need to wait for completion: it returns the `activityId` (allocated before fan-out — `runFusion` line 178) plus `ok/status/answer?` when the run finishes. To keep the request short and avoid a long-held connection (which would block an event-loop-bound server), **the route awaits `runFusion` and returns the final result in one response.** The client polls `/api/runtime` *in parallel* for live progress during that single in-flight request. (See R-003 for why holding one request is fine here but isn't the *progress* channel.)

**Alternatives considered**:
- *SSE stream from `POST /api/fusion`.* Rejected — new primitive, new client code, no existing pattern. `runFusion.onProgress` is a sync callback; bridging it to an SSE response is more code than polling `/api/runtime`.
- *Long-poll `POST /api/fusion` (hold until done).* This is effectively what the single-await approach is, but the progress channel is the *separate* `/api/runtime` poll, not the held connection. Keeping them separate matches the Dashboard and avoids coupling.
- *WebSocket.* Rejected — overkill for a local single-user tool.

---

## R-003 — Does `POST /api/fusion` hold the request until the fusion completes, or return immediately and require a separate "get result" poll?

**Decision**: **Hold the single request** — `POST /api/fusion` awaits `runFusion()` and returns the final `{ ok, status, answer?, error?, needsConfig?, activityId }`. Live progress during that in-flight request comes from the parallel `/api/runtime` poll (R-002), keyed on the `activityId`.

**Rationale**:
- A fusion is seconds-to-minutes (the user's `workerTimeoutMs`). A single held fetch is simpler than a kickoff+retrieve protocol — the browser's `fetch` happily awaits minutes, and there's no proxy/timeout in front (`127.0.0.1` direct).
- Returning immediately + polling for the *result* would mean either reusing 008's `fusion_jobs` durable table (overkill — R-001) or inventing a new ephemeral result cache (more code). Holding the request keeps the result in-memory on the `runFusion` return value — no cache needed.
- The `activityId` is returned regardless (it's on `FusionResult`); if the user closes the tab mid-run, the fusion still completes server-side and the row resolves in the DB (Generations will show it later). Reopening the Playground does **not** reattach (YAGNI — out of scope).
- Event-loop concern: one held request does not block other Express routes from *being handled* (Node handles concurrent requests cooperatively), but `better-sqlite3` writes are synchronous. This is the **existing** known limitation (feature 008 notes: "Tolerable for a single-user local tool"). A Playground fusion adds no new exposure beyond what an MCP fusion already has.

**Alternatives considered**:
- *Kickoff → poll-for-result (008-style).* Rejected for the browser — see R-001. The 008 protocol exists for non-Tasks MCP clients that need a reference_id; the browser has no such constraint.
- *Stream the result token-by-token.* Rejected — `runFusion` produces the answer atomically at synthesis completion (the judge's second step returns the whole synthesized text). There is no token stream to relay. (This is also why "Google AI Studio-like" is interpreted at the UX level, not token-streaming — see Assumptions.)

---

## R-004 — Where does the **Errors** tab go? Top-level, inside Settings, or inside Generations?

**Decision**: **Keep Errors as a top-level tab.** The consolidated nav becomes: **Playground · Dashboard · Generations · Settings · Errors** (Playground first, Settings replacing the four config tabs). Errors stays top-level.

**Rationale**:
- Errors is an *operational/observability* surface (read-only debugging of failed/partial fusions), not a *configuration* surface. Putting it under Settings conflates "configure the system" with "inspect what went wrong" — different user intents.
- Errors is consumed *immediately after a Playground run fails* — having it one click away from Playground (top-level) is the right information architecture. Burying it under Settings would add a click exactly when the user is debugging.
- Constitution V (Observable) treats the activity log + errors as a first-class dimension; demoting Errors to a sub-section would subtly downgrade it.

**Alternatives considered**:
- *Fold Errors into Settings (e.g. Settings → Diagnostics).* Rejected — conflates config with ops.
- *Fold Errors into Generations (a toggle: "all / errors only").* Rejected — Generations is already a master-detail reader; adding a filter mode changes its scope. The existing `api.getErrors()` already client-side-filters `getActivity`; keeping the dedicated page is cheaper.
- *Drop Errors entirely and rely on Dashboard.* Rejected — Dashboard shows aggregates, not the error text + sub-call breakdown that Errors provides.

**Scope note**: Errors is unchanged by this feature. The only nav change that touches it is that it's no longer the last of seven tabs — it's the last of five.

---

## R-005 — Do we need a new markdown renderer, syntax highlighter, or code-editor dependency for the Playground?

**Decision**: **No.** v1 reuses the existing hand-rolled `GenerationText` component (`ui/src/components/GenerationText.tsx`) for the answer + candidate outputs, and uses plain `<textarea className="field">` for the prompt + context inputs (matching `Personas.tsx`'s `PromptField`).

**Rationale**:
- `GenerationText` already renders markdown (headings, lists, bold, inline + fenced code) with a copy button and no `dangerouslySetInnerHTML`. It's what `Generations.tsx` uses to render candidate + synthesis text today. The Playground's result panel is the same rendering need.
- The prompt/context inputs are plain text. A code editor (`@codemirror/*`, `monaco-editor`) would be speculative flex (AGENTS.md §2) — there's no syntax to highlight in a prompt, and the existing textarea + monospace `.field` style is what `Personas.tsx` already does for prompt editing.
- Adding `react-markdown` + `remark-gfm` + a highlighter would balloon `ui/package.json` (currently 4 runtime deps — admirably lean) for marginal gain. **SC-006 explicitly forbids new deps in v1.**
- If post-v1 user feedback shows the hand-rolled renderer mishandles tables / nested lists / math, a follow-up feature can swap it — and at that point swap it for `Generations.tsx` too (single site).

**Alternatives considered**:
- *Add `react-markdown` + `remark-gfm` + `react-syntax-highlighter`.* Rejected for v1 (YAGNI, SC-006). Reconsider if the hand-rolled renderer proves insufficient.
- *Add `@codemirror/*` for the prompt box.* Rejected — no syntax to highlight; a textarea is enough.

---

## R-006 — How does the persona picker work, and does the Playground honor `personaPolicy: "strict"`?

**Decision**: The Playground renders a **persona dropdown** populated from `GET /api/personas` (the existing endpoint returns `{ personas, activePersona, personaPolicy }`). The user picks one (or "Active: <name>", the default). Because the route passes `source:"ui"`, the fusion is **policy-exempt** — even under `strict`, a user-selected override runs as-is and records `persona_source = "active"`.

**Rationale**:
- This is exactly the contract feature 006 modeled: UI calls bypass the policy because **the user is the picker** (`resolvePersonaWithPolicy` short-circuits on `source:"ui"` → `personaSource:"active"`, no event emitted). Feature 006's tasks.md T014 explicitly flagged that "no UI callsite exists today" — the Playground is that callsite. SC-003 verifies it.
- There is no `onPersonaEvent` to wire (UI source never emits). The route omits it.
- The `personaPolicy` value is still *displayed* in the Settings → Personas page (unchanged); it just doesn't gate the Playground. This is correct: `strict` means "don't let *MCP clients* override without asking", not "don't let the local user override".
- The picker's default is the active persona (`activePersona` from `/api/personas`); "Active" is visually distinct from overrides.

**Alternatives considered**:
- *Honor `strict` in the Playground (block overrides).* Rejected — contradicts feature 006's design (`source:"ui"` is the documented exemption) and would make the Playground less capable than an MCP client under `allow-override`.
- *Show a confirm dialog on override under `strict`.* Rejected — the user already chose; elicitation is for *agent-initiated* overrides, not user-initiated ones.

---

## R-007 — Does the Playground show candidate outputs + judge analysis inline, or just the final answer?

**Decision**: **Both, in a collapsed-by-default disclosure.** The final synthesized answer renders prominently (via `GenerationText`); below it, a collapsible "Show candidate responses & judge analysis" section reuses the `Generations.tsx` patterns (`CandidatesView` for the worker outputs, `JudgeView` for the analysis JSON + synthesis stats, `SubCallStats` for the chip rows). The data comes from `GET /api/activity/:id` using the `activityId` returned by `POST /api/fusion`.

**Rationale**:
- "Google AI Studio-like" implies visibility into what each model produced, not just the final answer — that's the whole point of a fusion panel. Hiding candidates would defeat the purpose.
- But the synthesized answer is the headline; candidate outputs are noisy. Collapsed-by-default keeps the default view clean while making the breakdown one click away.
- `Generations.tsx` already has `CandidatesView` + `JudgeView` + `SubCallStats` as *local* helpers (not exported). The Playground has two options: (a) import them by extracting to a shared module, or (b) inline equivalent JSX. **Decision: extract the three helpers + the `AnalysisShape` type into a small shared module** (e.g. `ui/src/components/FusionBreakdown.tsx`) so both Generations and Playground render identically, then have Generations import from there too. This is a *refactor of my own mess* (the helpers were local to Generations) — not a touching of unrelated code, so it's within AGENTS.md §3.
- The Playground fetches the full activity detail once the fusion completes (it has the `activityId`); the candidate/judge views need `sub_calls`, which the `POST /api/fusion` response does **not** carry. One follow-up `GET /api/activity/:id` is cheap and matches Generations' master-detail idiom.

**Alternatives considered**:
- *Final answer only; link to Generations for the breakdown.* Rejected — too many clicks; the Playground should be self-contained for a single run.
- *Always-expanded candidate panel.* Rejected — noisy default; collapsed-by-default respects the headline-then-detail hierarchy.
- *Inline-duplicate the Generations helpers into Playground.* Rejected — duplicates ~150 lines; extracting is the right call (single source of truth for the breakdown rendering).
