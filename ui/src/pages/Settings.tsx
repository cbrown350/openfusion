// Feature 009 — Settings shell.
//
// Consolidates the four configuration tabs (Candidates, Judge, Personas, API Keys) into one
// Settings tab with a left sidebar. The existing page components render UNCHANGED inside the
// shell — their config/onChanged props handshake with App.tsx is preserved (FR-011).
//
// The shell receives config/onChanged from App and passes them through to whichever sub-section
// is active (driven by the URL). This keeps the four page signatures untouched and avoids
// introducing a context provider for a four-element list.
import { NavLink, useParams } from "react-router-dom";
import type { AppConfig } from "../api";
import { CandidatesPage } from "./Candidates";
import { JudgePage } from "./Judge";
import { PersonasPage } from "./Personas";
import { ApiKeysPage } from "./ApiKeys";

const SECTIONS: { slug: string; label: string }[] = [
  { slug: "candidates", label: "Candidates" },
  { slug: "judge", label: "Judge" },
  { slug: "personas", label: "Personas" },
  { slug: "keys", label: "API Keys" },
];

export function SettingsPage({ config, onChanged }: { config: AppConfig | null; onChanged: () => void }) {
  // The sub-section is the first path segment after /settings. App.tsx redirects /settings →
  // /settings/candidates, so section is always defined here.
  const params = useParams();
  const section = params.section ?? "candidates";

  return (
    <div className="flex gap-4">
      {/* Left sidebar — the four sub-sections, active one highlighted. */}
      <aside className="glass w-48 flex-shrink-0 p-2">
        <h2 className="px-2 py-2 text-sm font-semibold text-white/80">Settings</h2>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.slug}
              to={`/settings/${s.slug}`}
              className={({ isActive }) =>
                `block rounded-md px-3 py-1.5 text-sm transition ${
                  isActive ? "bg-[#4cd0b0]/20 text-[#4cd0b0]" : "text-white/70 hover:bg-white/10"
                }`
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main pane — the active sub-section's page, rendered unchanged. */}
      <div className="min-w-0 flex-1">
        {section === "candidates" && <CandidatesPage config={config} onChanged={onChanged} />}
        {section === "judge" && <JudgePage config={config} onChanged={onChanged} />}
        {section === "personas" && <PersonasPage />}
        {section === "keys" && <ApiKeysPage config={config} />}
        {/* Unknown section slug — shouldn't happen (App redirects), but fall back gracefully. */}
        {!SECTIONS.some((s) => s.slug === section) && <CandidatesPage config={config} onChanged={onChanged} />}
      </div>
    </div>
  );
}
