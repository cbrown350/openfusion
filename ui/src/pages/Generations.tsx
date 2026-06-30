import { useEffect, useState } from "react";
import { api, type Activity, type SubCall } from "../api";
import { CandidatesView, JudgeView } from "../components/FusionBreakdown";

type ViewMode = "candidates" | "judge";

export function GenerationsPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<Activity | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [view, setView] = useState<ViewMode>("candidates");

  // Load recent activities for the dropdown.
  useEffect(() => {
    void api.getActivity({ limit: 50 }).then((r) => {
      setActivities(r.items);
      if (r.items.length && !selectedId) setSelectedId(r.items[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the selected activity's full detail (with sub_calls).
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    api
      .getActivityDetail(selectedId)
      .then(setDetail)
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const workers: SubCall[] = (detail?.sub_calls ?? []).filter((s) => s.role === "worker");
  const analysis = (detail?.sub_calls ?? []).find((s) => s.role === "judge_analysis");
  const synthesis = (detail?.sub_calls ?? []).find((s) => s.role === "judge_synthesis");
  const predatesLogging = (detail?.sub_calls ?? []).every(
    (s) => !s.generated_text && !s.analysis_json,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Generations</h2>
      <p className="-mt-2 text-sm text-white/60">
        Read what each model produced for a fusion, side by side.
      </p>

      {/* Top controls */}
      <div className="glass flex flex-wrap items-center gap-3 p-3">
        <label className="text-xs text-white/50">Activity</label>
        <select
          className="field min-w-[16rem] flex-1"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={activities.length === 0}
        >
          {activities.length === 0 && <option value="">No fusions yet</option>}
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {new Date(a.created_at).toLocaleString()} · {a.survivor_count}/{a.candidate_count} ·{" "}
              {(a.prompt_excerpt || "(no prompt)").slice(0, 60)}
            </option>
          ))}
        </select>
        <label className="text-xs text-white/50">View</label>
        <select className="field w-36" value={view} onChange={(e) => setView(e.target.value as ViewMode)}>
          <option value="candidates">Candidates</option>
          <option value="judge">Judge</option>
        </select>
        {detail?.persona && (
          <span
            className="rounded-full border border-[#4cd0b0]/40 bg-[#4cd0b0]/10 px-2.5 py-1 text-xs text-[#4cd0b0]"
            title={`Persona used for this fusion${detail.persona_source ? ` (source: ${detail.persona_source})` : ""}`}
          >
            ◈ {detail.persona}
            {detail.persona_source === "override" && " (client override)"}
            {detail.persona_source === "strict-enforced" && " (strict-enforced)"}
            {detail.persona_source === "invalid-fallback" && " (invalid-fallback)"}
          </span>
        )}
      </div>

      {loadingDetail && <p className="text-sm text-white/50">Loading…</p>}

      {!loadingDetail && detail && predatesLogging && (
        <div className="glass p-4 text-sm text-amber-200">
          Generation text wasn't recorded for this fusion (it predates generation logging).
        </div>
      )}

      {!loadingDetail && detail && !predatesLogging && view === "candidates" && (
        <CandidatesView workers={workers} />
      )}

      {!loadingDetail && detail && !predatesLogging && view === "judge" && (
        <JudgeView analysis={analysis} synthesis={synthesis} />
      )}
    </div>
  );
}

