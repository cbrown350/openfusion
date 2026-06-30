import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, type AppConfig } from "./api";
import { PlaygroundPage } from "./pages/Playground";
import { SettingsPage } from "./pages/Settings";
import { DashboardPage } from "./pages/Dashboard";
import { GenerationsPage } from "./pages/Generations";
import { ErrorsPage } from "./pages/Errors";

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setConfig(await api.getConfig());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="min-h-screen">
      <header className="glass mx-auto mt-6 flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <img src="/OpenFusion-logo.png" alt="OpenFusion" className="h-10 w-10 rounded-lg" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              <span className="bg-gradient-to-r from-[#4cd0b0] to-[#3498db] bg-clip-text text-transparent">
                OpenFusion
              </span>
            </h1>
            <p className="text-xs text-white/60">Fusion panel MCP server</p>
          </div>
        </div>
        <nav className="flex gap-1 text-sm">
          {[
            ["/playground", "Playground"],
            ["/dashboard", "Dashboard"],
            ["/generations", "Generations"],
            ["/settings", "Settings"],
            ["/errors", "Errors"],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 transition ${
                  isActive ? "bg-[#4cd0b0]/20 text-[#4cd0b0]" : "text-white/70 hover:bg-white/10"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href="https://www.paypal.com/ncp/payment/HR7GJ2RV7FFW6"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-pink-500/20 px-3 py-1 text-xs font-medium text-pink-300 transition hover:bg-pink-500/30"
            title="Support OpenFusion"
          >
            ♥ Donate
          </a>
          {config && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                config.configured ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {config.configured ? "● Configured" : "○ Needs setup"}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="mx-auto mt-4 max-w-5xl rounded-md bg-red-500/20 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {!config?.configured && (
        <div className="mx-auto mt-4 max-w-5xl rounded-md bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          OpenFusion isn't configured yet. Add ≥2 candidates, a judge, and an API key for each referenced provider to enable the{" "}
          <code className="rounded bg-black/30 px-1">fusion</code> tool.{" "}
          <Link to="/settings/candidates" className="underline">
            Start with candidates →
          </Link>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<PlaygroundPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/generations" element={<GenerationsPage />} />
          <Route path="/errors" element={<ErrorsPage />} />
          {/* Settings shell (feature 009): the four config pages consolidated under one tab. */}
          <Route path="/settings" element={<Navigate to="/settings/candidates" replace />} />
          <Route path="/settings/:section" element={<SettingsPage config={config} onChanged={refresh} />} />
          {/* Back-compat redirects: old top-level config paths → their new /settings/* homes. */}
          <Route path="/candidates" element={<Navigate to="/settings/candidates" replace />} />
          <Route path="/judge" element={<Navigate to="/settings/judge" replace />} />
          <Route path="/personas" element={<Navigate to="/settings/personas" replace />} />
          <Route path="/keys" element={<Navigate to="/settings/keys" replace />} />
        </Routes>
      </main>
    </div>
  );
}
