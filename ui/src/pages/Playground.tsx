// Feature 009 — Playground: a Google-AI-Studio-style MCP-client UI that runs fusions
// directly from the browser. Calls POST /api/fusion → runFusion({ source:"ui" }) (the
// persona-policy-exempt path — feature 006's dormant callsite). The run is logged identically
// to an MCP fusion (SC-002) and shows up in the Dashboard/Errors activity views.
//
// Layout: a chat-style composer spans full width on top; below it, a two-column row holds
// the session history/example prompts (left) and the live progress + synthesized answer +
// judge breakdown (right).
//
// Attachments: the paperclip in the composer reads local text/PDF files; their text is
// concatenated into the fusion `context` at run-time. Attachments are ephemeral (never stored
// — like all context, only a has_context flag is persisted) and not reflected when reloading
// a past run from history.
//
// UX:
//  - Run holds the request until the fusion completes; live progress comes from polling
//    GET /api/runtime in parallel (mirrors Dashboard's ServerStatus widget — paused when hidden).
//  - Result: synthesized answer via GenerationText + a collapsed-by-default breakdown via
//    FusionBreakdown (the shared breakdown components — single source of truth).
//  - needsConfig response renders as actionable amber (FR-014), with a deep-link to Settings.
//  - Run is disabled while a fusion is pending (client-side guard against double-submit).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ActiveFusion, type Activity, type Persona, type PlaygroundFusionResponse } from "../api";
import { GenerationText } from "../components/GenerationText";
import { CandidatesView, JudgeView } from "../components/FusionBreakdown";
import { ComposerAttachments, type Attachment } from "../components/ComposerAttachments";
import { FusionProgress } from "../components/FusionProgress";
import { fileToText } from "../lib/fileToText";

type Phase = "idle" | "running" | "done" | "error";

/** Grounded, fusion-tuned starters. persona ids are the real builtins (src/fusion/personas.ts). */
const EXAMPLES: { p: string; persona: string }[] = [
  { p: "Compare the tradeoffs of SSR vs SSG for a content-heavy marketing site.", persona: "researcher" },
  { p: "Design a token-bucket rate limiter. Find edge cases two models might miss.", persona: "architect" },
  { p: "What are the biggest blind spots in assuming microservices will fix our scaling?", persona: "qa" },
  { p: "Deep research: safest food-grade materials for a 120 °C 3D-printed mold.", persona: "researcher" },
  { p: "Prioritize these roadmap items for a 2-person seed-stage team.", persona: "pm" },
];

export function PlaygroundPage() {
  // --- widen the shell for this route only (App.tsx owns the token; we override it) ---
  useLayoutEffect(() => {
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("--shell-max");
    root.style.setProperty("--shell-max", "80rem");
    return () => {
      root.style.setProperty("--shell-max", prev || "64rem");
    };
  }, []);

  // --- form state ---
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [personaId, setPersonaId] = useState(""); // "" = active persona
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaName, setActivePersonaName] = useState("");

  // --- run state ---
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<PlaygroundFusionResponse | null>(null);
  const [detail, setDetail] = useState<Activity | null>(null);
  const [progress, setProgress] = useState<ActiveFusion | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [startedAt, setStartedAt] = useState(0); // epoch ms — elapsed display
  const activeActivityId = useRef<string | null>(null);
  const knownIdsAtStart = useRef<Set<string>>(new Set()); // for identifying my in-flight run

  // --- session history (left rail) ---
  const [history, setHistory] = useState<Activity[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");

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

  // Load recent past runs for the session-history rail.
  useEffect(() => {
    api.getActivity({ limit: 25 }).then((r) => setHistory(r.items)).catch(() => {
      // Best-effort — the rail stays empty.
    });
  }, []);

  // --- live progress poll while a fusion is running ---
  useEffect(() => {
    if (phase !== "running") return;
    const poll = () =>
      api.getStatus().then((s) => {
        const mine = resolveMine(s.fusions, activeActivityId.current, knownIdsAtStart.current);
        if (mine) {
          activeActivityId.current = mine.activityId; // lock on once it appears
          setProgress(mine);
        }
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
  const promptEmpty = prompt.trim().length === 0;
  // Context is derived from attachments at render time (also used to build the run body).
  const attachmentText = attachments.map((a) => `=== ${a.name} ===\n${a.text}`).join("\n\n");
  const charCount = (prompt + " " + attachmentText).length;
  const tokEstimate = Math.max(1, Math.round(charCount / 4)).toLocaleString();
  const overTokWarning = charCount / 4 > 100_000;
  const personaDesc = (personaId ? personas.find((p) => p.id === personaId) : personas.find((p) => p.id === "") || personas[0])?.description;

  /** Read FileList into attachments (text files + PDFs); bad files land as error chips. */
  async function handleFiles(files: FileList) {
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const text = await fileToText(file);
        next.push({ id, name: file.name, size: file.size, text });
      } catch {
        next.push({ id, name: file.name, size: file.size, text: "", error: "Could not read file" });
      }
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  async function run() {
    const p = prompt.trim();
    if (!p || running) return;
    // Snapshot the in-flight fusion ids just before kickoff so the progress poll can
    // identify "mine" before POST /api/fusion resolves with the authoritative id.
    try {
      const s = await api.getStatus();
      knownIdsAtStart.current = new Set(s.fusions.map((f) => f.activityId));
    } catch {
      knownIdsAtStart.current = new Set();
    }
    activeActivityId.current = null;
    setPhase("running");
    setResult(null);
    setDetail(null);
    setProgress(null);
    setShowBreakdown(false);
    setStartedAt(Date.now());
    try {
      const res = await api.runFusion({
        prompt: p,
        ...(attachmentText.trim() ? { context: attachmentText.trim() } : {}),
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
        // Refresh history so the new run lands in the rail.
        api.getActivity({ limit: 25 }).then((r) => setHistory(r.items)).catch(() => {});
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

  /** Reload a past run from the history rail into the result pane. */
  async function loadHistory(id: string) {
    if (running) return;
    setSelectedHistoryId(id);
    setResult(null);
    setProgress(null);
    setShowBreakdown(false);
    try {
      const d = await api.getActivityDetail(id);
      setDetail(d);
      // Reconstruct a minimal result so the result pane renders the recorded answer.
      const synthesis = (d.sub_calls ?? []).find((s) => s.role === "judge_synthesis");
      setResult({
        activityId: d.id,
        ok: d.status === "success" || d.status === "partial",
        status: d.status === "success" ? "success" : d.status === "partial" ? "partial" : "error",
        answer: synthesis?.generated_text ?? undefined,
        ...(d.status !== "success" && d.status !== "partial" ? { error: d.error ?? "This fusion did not complete." } : {}),
      });
      setPhase(d.status === "success" || d.status === "partial" ? "done" : "error");
      // Reflect the loaded run's prompt/persona in the composer (read-only context).
      setPrompt(d.prompt_excerpt ?? "");
      setPersonaId(d.persona ?? "");
    } catch {
      setPhase("error");
      setResult({ ok: false, status: "error", error: "Could not load that run." });
    }
  }

  function applyExample(ex: { p: string; persona: string }) {
    if (running) return;
    setPrompt(ex.p);
    setPersonaId(ex.persona);
    setSelectedHistoryId("");
  }

  // ⌘/Ctrl+Enter runs the fusion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // re-binds each render so the latest prompt/running state closes over fresh values

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Playground</h2>
        <p className="-mt-2 text-sm text-white/60">
          Run a fusion directly from the browser — no MCP client required. Same engine, same judging,
          same activity log as a tool-driven fusion.
        </p>
      </div>

      <div className="studio-v2">
        {/* ----------------------------- COMPOSER (full width) ----------------------------- */}
        <section className="span-full glass space-y-3 p-4">
          {/* --- Upfront not-configured banner (FR-013) — inline in the composer --- */}
          {missingSetup && (
            <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              <p>{missingSetup}</p>
              <Link to="/settings/candidates" className="btn-primary mt-2 inline-block text-xs">
                Open Settings → Candidates
              </Link>
            </div>
          )}

          {/* Chat-style input box: attachment chips + paperclip + prompt textarea + Run */}
          <div className="composer">
            <ComposerAttachments
              attachments={attachments}
              disabled={running}
              onPick={(files) => void handleFiles(files)}
              onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
            />
            <textarea
              placeholder="Ask anything…  (attach files to pass them as context)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running}
              rows={4}
            />
          </div>

          {overTokWarning && (
            <p className="-mt-1 px-1 text-xs text-amber-300">
              ~{tokEstimate} estimated tokens — context is sent to every candidate and scales cost (~Nx candidates + judge).
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
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
              {personaDesc && <p className="mt-1 text-xs text-white/45">{personaDesc}</p>}
            </div>
            <button
              type="button"
              className={`btn-primary ${running ? "is-running" : ""}`}
              onClick={() => void run()}
              disabled={running || promptEmpty || missingSetup !== null}
              title={
                running ? "Fusion running…"
                  : missingSetup ?? (promptEmpty ? "Type a prompt to run fusion" : "Run fusion  (⌘↵)")
              }
            >
              <svg className={`run-ico ${running ? "hidden" : ""}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
              </svg>
              <svg className={`run-ico spin ${running ? "" : "hidden"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
              </svg>
              <span>{running ? "Running…" : "Run fusion"}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-white/35">Tip: fusion works best on tradeoffs, blind-spot hunting, and deep research — not single-fact lookups.</p>
            <p className="num text-white/40">
              ~{tokEstimate} tok <span className="mx-1 text-white/20">·</span>{" "}
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-[10px] text-white/60">⌘↵</kbd> to run
            </p>
          </div>
        </section>

        {/* ----------------------- LEFT: Examples + History ----------------------- */}
        <aside className="order-hist glass space-y-4 p-3">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Example prompts</h3>
            <div className="space-y-1">
              {EXAMPLES.map((ex, i) => {
                const p = personas.find((x) => x.id === ex.persona);
                return (
                  <button
                    key={i}
                    type="button"
                    className="rail-item"
                    onClick={() => applyExample(ex)}
                    disabled={running}
                  >
                    <span className="line-clamp-2 text-sm text-white/85">{ex.p}</span>
                    <span className="num text-[11px] text-[#4cd0b0]/80">{p?.name ?? ex.persona}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-white/10 pt-3">
            <h3 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-white/40">
              <span>Session history</span>
              <span className="num normal-case text-white/30">{history.length}</span>
            </h3>
            <div className="space-y-1">
              {history.length === 0 && (
                <p className="px-1 text-xs text-white/30">No fusions yet.</p>
              )}
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`rail-item ${selectedHistoryId === h.id ? "active" : ""}`}
                  onClick={() => void loadHistory(h.id)}
                  disabled={running}
                >
                  <span className="line-clamp-2 text-sm text-white/85">
                    {h.prompt_excerpt || "(no prompt)"}
                  </span>
                  <span className="num text-[11px] text-white/45">
                    {h.persona ?? "—"} · {(h.total_latency_ms / 1000).toFixed(1)}s · {h.survivor_count}/{h.candidate_count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ----------------------------- RIGHT: Result ----------------------------- */}
        <section className="order-res glass p-4">
          {/* Run metadata bar (after a run lands) */}
          {!running && detail && (phase === "done" || phase === "error") && (
            <MetadataBar detail={detail} />
          )}

          {/* Live per-candidate progress (while running) — the same PhaseBar the Dashboard uses. */}
          {running && <FusionProgress fusion={progress} startedAt={startedAt} />}

          {/* Empty state */}
          {!running && !result && (
            <div className="flex h-48 flex-col items-center justify-center text-center">
              <div
                className="mb-2 flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: "rgba(76,208,176,0.10)", border: "1px solid rgba(76,208,176,0.25)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="#4cd0b0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm text-white/55">Run a fusion to see the synthesized answer,</p>
              <p className="text-sm text-white/55">per-candidate breakdown, and judge analysis here.</p>
            </div>
          )}

          {/* Result block — only when not running (avoids a stale result flashing while a new
              fusion is in flight; FusionProgress owns the running state). */}
          {!running && result && result.ok && (
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[#4cd0b0]">Synthesized answer</h3>
                {result.status === "partial" && (
                  <span className="text-xs text-amber-300">partial — some candidates failed</span>
                )}
              </div>
              <div className="gen-scroll mt-2 pr-1">
                <GenerationText text={result.answer ?? ""} />
              </div>

              {detail && detail.sub_calls && detail.sub_calls.length > 0 && (
                <div className="mt-4 border-t border-white/10 pt-3">
                  <button className="btn text-xs" onClick={() => setShowBreakdown((s) => !s)}>
                    {showBreakdown ? "▾ Hide" : "▸ Show"} candidate responses &amp; judge analysis
                  </button>
                  {showBreakdown && <Breakdown detail={detail} />}
                </div>
              )}
            </div>
          )}

          {/* --- needsConfig (amber, actionable — FR-014) --- */}
          {!running && result && !result.ok && result.needsConfig && (
            <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-4">
              <h3 className="mb-1 text-sm font-medium text-amber-300">OpenFusion isn't configured</h3>
              <p className="text-sm text-white/70">{result.error}</p>
              <Link to="/settings/candidates" className="btn-primary mt-3 inline-block text-xs">
                Open Settings → Candidates
              </Link>
            </div>
          )}

          {/* --- Runtime error (red) --- */}
          {!running && result && !result.ok && !result.needsConfig && (
            <div className="rounded-md border border-red-400/40 bg-red-500/10 p-4">
              <h3 className="mb-1 text-sm font-medium text-red-300">Fusion failed</h3>
              <pre className="whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-sm text-red-200">
                {result.error}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** During a run, identify the fusion we launched from /api/runtime's list:
 *  the authoritative id (if POST already resolved), else the one not present at kickoff
 *  (newest by startedAt on ties). Single-user local tool — this is robust enough. */
function resolveMine(
  fusions: ActiveFusion[],
  knownId: string | null,
  knownAtStart: Set<string>,
): ActiveFusion | null {
  if (knownId) return fusions.find((f) => f.activityId === knownId) ?? null;
  const newcomers = fusions.filter((f) => !knownAtStart.has(f.activityId));
  if (newcomers.length === 0) return null;
  return newcomers.reduce((a, b) => ((b.startedAt ?? 0) > (a.startedAt ?? 0) ? b : a));
}

/** Run-metadata bar: cost · tokens · latency · survivors · persona · source, from the activity row. */
function MetadataBar({ detail }: { detail: Activity }) {
  const cells: { label: string; value: string; accent?: boolean }[] = [
    { label: "cost", value: detail.total_cost ? `$${detail.total_cost.toFixed(5)}` : "—" },
    { label: "tokens", value: `${detail.total_input_tokens}/${detail.total_output_tokens}` },
    { label: "latency", value: `${(detail.total_latency_ms / 1000).toFixed(1)}s` },
    { label: "survivors", value: `${detail.survivor_count}/${detail.candidate_count}`, accent: true },
    { label: "persona", value: detail.persona ?? "—" },
    { label: "source", value: "ui" },
  ];
  return (
    <div className="num mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-black/20 px-3 py-2 text-xs text-white/65">
      {cells.map((c, i) => (
        <span key={c.label} className="flex items-center gap-x-3">
          {i > 0 && <span className="text-white/20">·</span>}
          <span className="text-white/40">{c.label}</span>{" "}
          <span className={c.accent ? "text-[#4cd0b0]" : "text-white/90"}>{c.value}</span>
        </span>
      ))}
    </div>
  );
}

/** The candidate/judge breakdown, shown inline below the synthesized answer. */
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
