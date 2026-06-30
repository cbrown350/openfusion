// Feature 009 — Playground page.
//
// A Google-AI-Studio-style MCP client UI: type a prompt (+ optional context, + optional persona),
// hit Run, watch live fan-out → analysis → synthesis progress, then read the synthesized answer +
// the per-candidate + judge breakdown inline. Zero MCP client setup.
//
// The Playground is the first UI callsite that *launches* a fusion. It calls POST /api/fusion,
// which runs runFusion with source:"ui" (persona-policy-exempt — activates feature 006's dormant
// path). The run is logged identically to an MCP fusion (SC-002) and shows up in Generations.
//
// UX:
//  - Run holds the request until the fusion completes; live progress comes from polling
//    GET /api/runtime in parallel (mirrors Dashboard's ServerStatus widget — paused when hidden).
//  - Result: synthesized answer via GenerationText + a collapsed-by-default breakdown via
//    FusionBreakdown (the same components Generations uses — single source of truth).
//  - needsConfig response renders as actionable amber (FR-014), with a deep-link to Settings.
//  - Run is disabled while a fusion is pending (client-side guard against double-submit).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ActiveFusion, type Activity, type Persona, type PlaygroundFusionResponse } from "../api";
import { GenerationText } from "../components/GenerationText";
import { CandidatesView, JudgeView } from "../components/FusionBreakdown";

type Phase = "idle" | "running" | "done" | "error";

export function PlaygroundPage() {
  // --- form state ---
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [personaId, setPersonaId] = useState(""); // "" = active persona
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaName, setActivePersonaName] = useState("");

  // --- run state ---
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PlaygroundFusionResponse | null>(null);
  const [detail, setDetail] = useState<Activity | null>(null);
  const [progress, setProgress] = useState<ActiveFusion | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const activeActivityId = useRef<string | null>(null);

  // --- upfront config check (FR-013) ---
  // Structural gate client-side: <2 enabled candidates or no enabled judge → disable Run.
  // Key completeness isn't knowable client-side; it surfaces via the run response (needsConfig).
  const [missingSetup, setMissingSetup] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((cfg) => {
      const enabledCandidates = (cfg.candidates ?? []).filter((c) => c.enabled).length;
      const hasJudge = (cfg.judges ?? []).some((j) => j.enabled);
      if (enabledCandidates < 2) setMissingSetup(`Need at least 2 enabled candidates (have ${enabledCandidates}).`);
      else if (!hasJudge) setMissingSetup("Need at least 1 enabled judge.");
      else setMissingSetup(null);
    }).catch(() => {
      // Config fetch failed — leave Run enabled; the run itself will surface the error.
    });
  }, []);

  // Load the persona list once on mount (default = active persona).
  useEffect(() => {
    api.getPersonas().then((r) => {
      setPersonas(r.personas);
      const active = r.personas.find((p) => p.id === r.activePersona);
      setActivePersonaName(active?.name ?? r.activePersona);
    }).catch(() => {
      // Best-effort — the persona dropdown just stays empty; a run still works (defaults to active).
    });
  }, []);

  // --- live progress poll while a fusion is running ---
  useEffect(() => {
    if (phase !== "running") return;
    const poll = () =>
      api.getStatus().then((s) => {
        const mine = activeActivityId.current
          ? s.fusions.find((f) => f.activityId === activeActivityId.current) ?? null
          : null;
        setProgress(mine);
      }).catch(() => {
        // leave the last snapshot
      });
    void poll();
    const POLL_MS = 2000;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase]);

  const running = phase === "running";

  async function run() {
    const p = prompt.trim();
    if (!p || running) return;
    setPhase("running");
    setResult(null);
    setDetail(null);
    setProgress(null);
    setShowBreakdown(false);
    try {
      const res = await api.runFusion({
        prompt: p,
        ...(context.trim() ? { context: context.trim() } : {}),
        ...(personaId ? { persona: personaId } : {}),
      });
      activeActivityId.current = res.activityId ?? null;
      setResult(res);
      if (res.ok && res.activityId) {
        // Fetch the full activity (with sub_calls) for the breakdown view.
        try {
          const d = await api.getActivityDetail(res.activityId);
          setDetail(d);
        } catch {
          // The answer still rendered; the breakdown is best-effort.
        }
        setPhase("done");
      } else if (res.needsConfig) {
        setPhase("done"); // amber, not red — handled in render
      } else {
        setPhase("error");
      }
    } catch (e) {
      // Network/transport failure (the route itself never throws on a fusion failure).
      setResult({ ok: false, status: "error", error: (e as Error).message });
      setPhase("error");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Playground</h2>
        <p className="-mt-2 text-sm text-white/60">
          Run a fusion directly from the browser — no MCP client required. Same engine, same judging,
          same activity log as a tool-driven fusion.
        </p>
      </div>

      {/* --- Upfront not-configured banner (FR-013) --- */}
      {missingSetup && (
        <section className="glass border border-amber-400/40 p-4">
          <h3 className="mb-1 text-sm font-medium text-amber-300">Not configured yet</h3>
          <p className="text-sm text-white/70">{missingSetup}</p>
          <Link to="/settings/candidates" className="btn-primary mt-3 inline-block text-xs">
            Open Settings → Candidates
          </Link>
        </section>
      )}

      {/* --- Prompt form --- */}
      <section className="glass space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">Prompt</label>
          <textarea
            className="field min-h-[6rem] font-mono text-sm"
            placeholder="Ask anything…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={running}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
            Context <span className="normal-case text-white/30">(optional)</span>
          </label>
          <textarea
            className="field min-h-[4rem] font-mono text-sm"
            placeholder="Background context, prior reasoning, or tool results to pass to the candidates…"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={running}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
              Persona <span className="normal-case text-white/30">(optional override)</span>
            </label>
            <select
              className="field text-sm"
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              disabled={running}
            >
              <option value="">Active: {activePersonaName || "(none)"}</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.builtin ? " (built-in)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn-primary"
            onClick={() => void run()}
            disabled={running || prompt.trim().length === 0 || missingSetup !== null}
            title={missingSetup ?? undefined}
          >
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </section>

      {/* --- Live progress (while running) --- */}
      {running && <ProgressIndicator fusion={progress} />}

      {/* --- Result --- */}
      {result && result.ok && (
        <section className="glass space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#4cd0b0]">Synthesized answer</h3>
            {result.status === "partial" && (
              <span className="text-xs text-amber-300">partial — some candidates failed</span>
            )}
          </div>
          <GenerationText text={result.answer ?? ""} />
          {detail && detail.sub_calls && detail.sub_calls.length > 0 && (
            <div className="border-t border-white/10 pt-3">
              <button
                className="btn text-xs"
                onClick={() => setShowBreakdown((s) => !s)}
              >
                {showBreakdown ? "▾ Hide" : "▸ Show"} candidate responses &amp; judge analysis
              </button>
              {showBreakdown && <Breakdown detail={detail} />}
            </div>
          )}
        </section>
      )}

      {/* --- needsConfig (amber, actionable — FR-014) --- */}
      {result && !result.ok && result.needsConfig && (
        <section className="glass border border-amber-400/40 p-4">
          <h3 className="mb-1 text-sm font-medium text-amber-300">OpenFusion isn't configured</h3>
          <p className="text-sm text-white/70">{result.error}</p>
          <Link to="/settings/candidates" className="btn-primary mt-3 inline-block text-xs">
            Open Settings → Candidates
          </Link>
        </section>
      )}

      {/* --- Runtime error (red) --- */}
      {result && !result.ok && !result.needsConfig && (
        <section className="glass border border-red-400/40 p-4">
          <h3 className="mb-1 text-sm font-medium text-red-300">Fusion failed</h3>
          <pre className="whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-sm text-red-200">
            {result.error}
          </pre>
        </section>
      )}
    </div>
  );
}

/** Compact progress affordance for the in-flight fusion: phase chip + candidate count + elapsed. */
function ProgressIndicator({ fusion }: { fusion: ActiveFusion | null }) {
  const elapsed = fusion ? Math.max(0, Math.round((Date.now() - fusion.startedAt) / 1000)) : 0;
  const phase = fusion?.phase ?? "fan-out";
  const done = fusion?.candidatesDone ?? 0;
  const total = fusion?.candidateCount ?? 0;
  return (
    <section className="glass p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-sm font-medium text-white/80">
            {fusion ? "Running" : "Starting…"}
          </span>
        </div>
        {fusion && <span className="text-xs text-white/40">{elapsed}s</span>}
      </div>
      {fusion && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
          {(["fan-out", "analysis", "synthesis"] as const).map((ph) => (
            <span
              key={ph}
              className={`rounded-full px-2.5 py-1 ${
                phase === ph
                  ? "bg-[#4cd0b0]/20 text-[#4cd0b0]"
                  : "bg-white/5 text-white/40"
              }`}
            >
              {ph === "fan-out" ? "Fan-out" : ph === "analysis" ? "Analysis" : "Synthesis"}
            </span>
          ))}
          <span className="text-white/40">·</span>
          <span>
            {fusion.mode === "sequential" && fusion.candidateIndex
              ? `candidate ${fusion.candidateIndex} of ${total}`
              : `${done} of ${total} responding`}
          </span>
        </div>
      )}
    </section>
  );
}

/** The candidate/judge breakdown, mirroring Generations' two views in one block. */
function Breakdown({ detail }: { detail: Activity }) {
  const workers = (detail.sub_calls ?? []).filter((s) => s.role === "worker");
  const analysis = (detail.sub_calls ?? []).find((s) => s.role === "judge_analysis");
  const synthesis = (detail.sub_calls ?? []).find((s) => s.role === "judge_synthesis");
  return (
    <div className="mt-3 space-y-4">
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Candidates</h4>
        <CandidatesView workers={workers} />
      </div>
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Judge</h4>
        <JudgeView analysis={analysis} synthesis={synthesis} />
      </div>
    </div>
  );
}
