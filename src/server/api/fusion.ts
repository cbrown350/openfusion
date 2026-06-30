// POST /api/fusion — the Playground API (feature 009).
//
// The Playground is the first UI callsite that *launches* a fusion rather than only reading
// past ones. It calls runFusion DIRECTLY with source:"ui" — NOT via the MCP stdio tool, the
// 005 Tasks path, or the 008 _resume_from durable path (research.md R-001). Because runFusion
// is the single gate/fan-out/judge/logging site, a Playground fusion is byte-identical in its
// durable record to an MCP fusion (SC-002) — it appears in Dashboard/Generations/Errors/Stats
// with zero special-casing.
//
// source:"ui" is load-bearing (FR-004): it activates feature 006's dormant persona-policy
// exemption — "no UI callsite exists today" was flagged in spec 006 tasks.md T014. This is it.
// Even under personaPolicy:"strict", a user-selected persona override runs and the activity
// row records persona_source = "active" (SC-003). No onPersonaEvent is wired (UI source never emits).
//
// The route holds the single in-flight request and returns the final result; the browser polls
// GET /api/runtime in parallel for live progress (research.md R-002/R-003). No new persistence,
// no new progress channel.
import { Router, type Request, type Response } from "express";
import { runFusion } from "../../fusion/fusion.js";
import { loadConfig } from "../../config/store.js";
import { paths } from "../../util/paths.js";
import type { DB } from "../../store/db.js";

/** Playground fusion request body (contracts/playground-api.md). Never carries key material. */
interface PlaygroundFusionRequest {
  prompt: string;
  context?: string;
  persona?: string;
}

/** Response: a thin projection of FusionResult + the activityId. Fields omitted when not applicable. */
export interface PlaygroundFusionResponse {
  activityId?: string;
  ok: boolean;
  status: "success" | "partial" | "error";
  answer?: string;
  error?: string;
  needsConfig?: boolean;
}

export function fusionRouter(db: DB): Router {
  const r = Router();
  r.post("/", async (req: Request, res: Response) => {
    const { prompt, context, persona } = (req.body ?? {}) as Partial<PlaygroundFusionRequest>;
    // Validate inline (not via thrown error) so a malformed request yields a clean 400
    // regardless of whether the host app installed the uniform error envelope.
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json({ error: "BAD_REQUEST", detail: "prompt is required" });
      return;
    }

    // source:"ui" → persona-policy-exempt; runFusion owns the gate, fan-out, judging, logging.
    // FR-008 (logged identically to an MCP fusion) holds by construction — runFusion is the
    // single logging site. Verified empirically by SC-002 / quickstart E1.
    const result = await runFusion({
      prompt: prompt.trim(),
      ...(context !== undefined && context !== null ? { context } : {}),
      ...(persona !== undefined && persona !== null ? { persona } : {}),
      config: loadConfig(),
      db,
      source: "ui",
      secretsPath: paths.secrets(),
      keyPath: paths.masterKey(),
    });

    const body: PlaygroundFusionResponse = {
      ...(result.activityId !== undefined ? { activityId: result.activityId } : {}),
      ok: result.ok,
      status: result.status,
      ...(result.answer !== undefined ? { answer: result.answer } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.needsConfig === true ? { needsConfig: true } : {}),
    };
    res.json(body);
  });
  return r;
}
