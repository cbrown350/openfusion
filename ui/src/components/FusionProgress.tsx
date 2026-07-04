// Shared live-fusion progress affordance, used by the Dashboard (ServerStatus) and the
// Playground (result pane while a run is in flight). Single source of truth — extracted
// from Dashboard.tsx so the two surfaces render progress identically.
//
// PhaseBar: the segmented phase bar + candidate dot-row. Requires a known fusion
// (the /api/runtime entry once the poll has locked on).
// FusionProgress: a null-safe wrapper that renders PhaseBar when the fusion is known,
// else a compact "Starting…" affordance (used before the first poll resolves).
import { useState, useEffect } from "react";
import type { ActiveFusion } from "../api";

const PHASES = ["fan-out", "analysis", "synthesis"] as const;
const PHASE_LABELS: Record<string, string> = {
  "fan-out": "Fan-out",
  analysis: "Analysis",
  synthesis: "Synthesis",
};

/**
 * One fusion's progress affordance: a segmented phase bar + candidate dot-row.
 * - phase known (same-process): 3-segment bar with completed/active/pending states.
 * - phase unknown (cross-process): a single indeterminate shimmer bar.
 * Compact mode (queued, >1 fusion) trims the candidate row.
 */
export function PhaseBar({ fusion: f, compact }: { fusion: ActiveFusion; compact?: boolean }) {
  const elapsed = Math.max(0, Math.round((Date.now() - f.startedAt) / 1000));
  const done = f.candidatesDone ?? 0;
  const phaseKnown = f.phase !== undefined;
  const activeIdx = phaseKnown ? PHASES.indexOf(f.phase!) : -1;

  // Candidate dots: teal for done/responding, white/15 for pending, ringed for the
  // currently-running sequential candidate.
  const dots = Array.from({ length: f.candidateCount }, (_, i) => {
    const isDone = i < done;
    const isActive = f.mode === "sequential" && i + 1 === f.candidateIndex;
    return (
      <span
        key={i}
        className={`inline-block h-2 w-2 rounded-full ${
          isDone
            ? "bg-[#4cd0b0]"
            : isActive
              ? "bg-[#4cd0b0]/40 ring-1 ring-[#4cd0b0] animate-pulse"
              : "bg-white/15"
        }`}
      />
    );
  });

  return (
    <div className="rounded-lg bg-white/[0.03] p-3">
      {/* Header: mode + phase label + elapsed */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/60">
          {f.mode}
          {phaseKnown ? ` · ${PHASE_LABELS[f.phase!]}` : " · phase unknown"}
        </span>
        <span className="text-xs text-white/40">{elapsed}s</span>
      </div>

      {phaseKnown ? (
        <>
          {/* Segmented phase bar: 3 segments, completed fill with brand gradient,
              active pulses, pending stays on track. */}
          <div className="mt-2 flex gap-1">
            {PHASES.map((ph, i) => {
              const completed = i < activeIdx;
              const active = i === activeIdx;
              // Within the active fan-out segment, partial fill = candidate progress.
              const fanoutFill =
                active && ph === "fan-out" && f.candidateCount > 0
                  ? Math.min(1, done / f.candidateCount)
                  : active
                    ? 0.5
                    : 0;
              return (
                <div key={ph} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  {(completed || active) && (
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${
                        active ? "animate-pulse" : ""
                      }`}
                      style={{
                        width: `${(completed ? 1 : fanoutFill) * 100}%`,
                        background: "linear-gradient(135deg, #4cd0b0, #3498db)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* Phase labels with state glyphs */}
          <div className="mt-1.5 flex justify-between">
            {PHASES.map((ph, i) => (
              <span
                key={ph}
                className={`flex-1 text-center text-[10px] ${
                  i < activeIdx
                    ? "text-[#4cd0b0]"
                    : i === activeIdx
                      ? "text-white/80"
                      : "text-white/30"
                }`}
              >
                {i < activeIdx ? "✓" : i === activeIdx ? "●" : "○"} {PHASE_LABELS[ph]}
              </span>
            ))}
          </div>
        </>
      ) : (
        // Cross-process / phase unknown: a single indeterminate shimmer bar.
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full w-1/3 animate-pulse rounded-full"
            style={{ background: "linear-gradient(135deg, #4cd0b0, #3498db)" }}
          />
        </div>
      )}

      {/* Candidate dot-row (hidden in compact/queued mode) */}
      {!compact && (
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-white/35">
            {f.mode === "sequential" ? "Candidates" : "Responding"}
          </span>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">{dots}</div>
            <span className="ml-1 text-[10px] text-white/40">
              ({done} of {f.candidateCount})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Null-safe progress widget for the Playground: renders PhaseBar once the fusion is
 * known from /api/runtime; before that (the first poll hasn't resolved) shows a
 * compact "Starting…" affordance with a pulsing dot + an elapsed counter.
 */
export function FusionProgress({ fusion, startedAt }: { fusion: ActiveFusion | null; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.round((now - (startedAt || fusion?.startedAt || Date.now())) / 1000));

  if (!fusion) {
    return (
      <div className="rounded-lg bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="dot resp" />
            <span className="text-sm font-medium text-white/80">Starting…</span>
          </div>
          <span className="text-xs text-white/40">{elapsed}s</span>
        </div>
      </div>
    );
  }
  return <PhaseBar fusion={fusion} />;
}
