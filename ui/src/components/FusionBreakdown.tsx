// Shared rendering of a fusion's per-candidate + judge breakdown.
// Extracted from Generations.tsx (feature 009) so the Playground renders the breakdown identically
// to the Generations detail view — single source of truth. No behavior change to Generations.
import { useEffect, useState } from "react";
import type { SubCall } from "../api";
import { GenerationText } from "./GenerationText";

/** The judge's structured analysis (the record_analysis tool-call payload). */
export interface AnalysisShape {
  consensus: string[];
  contradictions: string[];
  partialCoverage: string[];
  uniqueInsights: string[];
  blindSpots: string[];
}

/** Horizontally-scrollable row of candidate boxes; each box picks a candidate via dropdown. */
export function CandidatesView({ workers }: { workers: SubCall[] }) {
  // Each box holds an index into the workers array. Default: first two.
  const [boxes, setBoxes] = useState<number[]>([0, 1]);

  // Reset to defaults when the set of workers changes (new activity selected).
  useEffect(() => {
    setBoxes(workers.length >= 2 ? [0, 1] : workers.length === 1 ? [0] : []);
  }, [workers]);

  if (workers.length === 0) {
    return <div className="glass p-4 text-sm text-white/50">No candidate generations for this fusion.</div>;
  }

  const addBox = () => setBoxes((b) => [...b, Math.min(b.length, workers.length - 1)]);
  const setBox = (i: number, workerIdx: number) =>
    setBoxes((b) => b.map((v, idx) => (idx === i ? workerIdx : v)));
  const removeBox = (i: number) => setBoxes((b) => (b.length <= 1 ? b : b.filter((_, idx) => idx !== i)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-white/50">{workers.length} candidate generation(s) · scroll ↔ to compare more</p>
        <button className="btn" onClick={addBox} disabled={boxes.length >= workers.length}>
          + Add box
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {boxes.map((workerIdx, boxIdx) => {
          const w = workers[workerIdx];
          if (!w) return null;
          return (
            <div key={boxIdx} className="glass-soft flex w-[22rem] min-w-0 flex-shrink-0 flex-col p-3">
              <div className="mb-2 flex items-center gap-2">
                <select
                  className="field min-w-0 flex-1 truncate text-xs"
                  value={workerIdx}
                  onChange={(e) => setBox(boxIdx, Number(e.target.value))}
                >
                  {workers.map((ww, i) => (
                    <option key={ww.id} value={i}>
                      {ww.slot_id ?? `candidate ${i + 1}`} · {ww.provider}/{ww.model}
                    </option>
                  ))}
                </select>
                {boxes.length > 1 && (
                  <button
                    className="btn-icon flex-shrink-0"
                    onClick={() => removeBox(boxIdx)}
                    title="Remove box"
                    aria-label="Remove box"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="mb-2 min-h-0 flex-1 max-h-96 overflow-y-auto pr-1">
                <GenerationText text={w.generated_text ?? ""} />
              </div>
              <SubCallStats s={w} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Single box: the judge's structured analysis + synthesized answer, with stats. */
export function JudgeView({ analysis, synthesis }: { analysis?: SubCall; synthesis?: SubCall }) {
  const parsed: AnalysisShape | null = analysis?.analysis_json
    ? safeParse(analysis.analysis_json)
    : null;
  return (
    <div className="space-y-3">
      {analysis && (
        <div className="glass-soft p-4">
          <h3 className="mb-2 text-sm font-medium text-[#4cd0b0]">Judge analysis</h3>
          {parsed ? (
            <div className="space-y-2 text-sm">
              <AnalysisField label="Consensus" items={parsed.consensus} />
              <AnalysisField label="Contradictions" items={parsed.contradictions} />
              <AnalysisField label="Partial coverage" items={parsed.partialCoverage} />
              <AnalysisField label="Unique insights" items={parsed.uniqueInsights} />
              <AnalysisField label="Blind spots" items={parsed.blindSpots} />
            </div>
          ) : (
            <p className="text-sm italic text-white/40">Analysis not recorded.</p>
          )}
          <div className="mt-3 border-t border-white/10 pt-2">
            <SubCallStats s={analysis} />
          </div>
        </div>
      )}
      {synthesis && (
        <div className="glass-soft p-4">
          <h3 className="mb-2 text-sm font-medium text-[#4cd0b0]">Judge synthesis (final answer)</h3>
          <div className="max-h-[40rem] overflow-y-auto pr-1">
            <GenerationText text={synthesis.generated_text ?? ""} />
          </div>
          <div className="mt-3 border-t border-white/10 pt-2">
            <SubCallStats s={synthesis} />
          </div>
        </div>
      )}
      {!analysis && !synthesis && (
        <div className="glass p-4 text-sm text-white/50">No judge generation for this fusion.</div>
      )}
    </div>
  );
}

function AnalysisField({ label, items }: { label: string; items?: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-white/40">{label}</p>
      {items && items.length ? (
        <ul className="ml-4 list-disc text-white/80">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : (
        <p className="text-white/40">—</p>
      )}
    </div>
  );
}

/** Compact chip row of a sub-call's metrics. Reused across candidate + judge views. */
export function SubCallStats({ s }: { s: SubCall }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-white/50">
      <span>{s.provider}/{s.model}</span>
      <span>·</span>
      <span>tokens {s.input_tokens}/{s.output_tokens}</span>
      <span>·</span>
      <span>${s.cost.toFixed(5)}</span>
      <span>·</span>
      <span>{(s.latency_ms / 1000).toFixed(1)}s</span>
      <span>·</span>
      <span className={s.status === "ok" ? "text-emerald-300" : "text-red-300"}>{s.status}</span>
    </div>
  );
}

function safeParse(s: string): AnalysisShape | null {
  try {
    return JSON.parse(s) as AnalysisShape;
  } catch {
    return null;
  }
}
