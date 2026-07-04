# OpenFusion 0.3.1

**Run a fusion from your browser, mix in local + cloud models, no MCP client required.**

Released July 4, 2026.

---

## Highlights

### 🎛️ The Playground: a fusion workbench in your browser
You no longer need to wire up an MCP client to use OpenFusion. OpenFusion 0.3.1 ships a brand-new **Playground** tab as the dashboard's new home — a Google-AI-Studio-style workbench where you type a prompt, attach files, pick a persona, hit **Run**, and watch the whole fan-out → analysis → synthesis pipeline happen live, then read the synthesized answer with the per-candidate and judge breakdown right there.

**Who it's for:** Anyone who wants to try OpenFusion (or run a one-off fusion) without setting up Claude Code, Cursor, or another MCP client first.
**Why it matters:** It removes the biggest friction to trying and using OpenFusion. Every Playground run is a real fusion — same engine, same judging, same activity log as a tool-driven fusion.

### 🔌 Bring your own local + cloud models (rapid-MLX & Ollama Cloud)
Two new OpenAI-compatible providers ship built in:

- **`rapid-mlx`** — run fusions against local Apple-Silicon models via the rapid-MLX server. **No API key required.** Great for free, private, on-device fusions.
- **`ollama-cloud`** — Ollama's hosted endpoint. Bring your Ollama API key and fuse across their hosted model lineup.

Both auto-discover their available models from the provider's `/v1/models` endpoint, so the model picker always shows what's actually running — no hardcoded lists to go stale.

---

## New features

### Run fusions from the Playground
- **Composer + file attachments** — type a prompt; optionally attach text/PDF files (parsed in your browser) whose contents flow into the fusion's `context`. Attachments are ephemeral and never leave your machine unmasked.
- **Persona picker** — override the active persona per-run right from the Playground (Generalist, Researcher, QA, Architect, PM, or your own).
- **Live progress** — watch each phase (fan-out → analysis → synthesis) and candidate as it lands, powered by the same engine-status feed the Dashboard uses.
- **Session history** — your recent fusions live in a left rail; click any one to reload its answer and full breakdown.
- **Runs are first-class** — a Playground fusion is logged identically to an MCP fusion and shows up in your Dashboard, Stats, and Errors like any other.

### Custom OpenAI-compatible providers
- **Keyless local models** — `rapid-mlx` needs no API key; the config completeness gate skips it. Configure it once and `fusion` works immediately.
- **Dynamic model discovery** — the Candidates/Judge pickers fetch the live model list from any discoverable provider, so you're always choosing from models that actually exist on the server.
- **Friendlier provider UI** — keyless providers show a "not required" badge instead of "missing"; friendly provider names replace raw ids in dropdowns.

---

## Improvements

- **Generations, folded in** — the old Generations tab is gone. Reading any past fusion's candidate/judge output now happens inline in the Playground's history rail + breakdown, using the same components. Nav is tighter: **Playground · Dashboard · Settings · Errors**. `/generations` redirects to `/playground` so old bookmarks work.
- **Settings, consolidated** — Candidates, Judge, Personas, and API Keys are now sub-sections of one **Settings** tab with a left sidebar. Old URLs (`/candidates`, `/judge`, `/personas`, `/keys`) redirect to their new homes.
- **Sharper Markdown** — fusion answers now render with full GitHub-Flavored Markdown (tables, strikethrough, autolinks, code fences) via `react-markdown` + `remark-gfm`, replacing the old hand-rolled renderer.
- **Bigger payloads** — the API body limit rose from 1 MB to 25 MB so large file-attachment contexts aren't rejected. The UI still warns you past ~100k estimated tokens.
- **Tighter, self-contained Run button** — the Playground's Run button (and the dashboard's action links) now render as proper buttons instead of gradient stubs.

---

## How to update

This release ships to npm. Update in one command:

```bash
npm install -g openfusion-mcp@0.3.1
```

Or run it on demand without a global install:

```bash
npx -y openfusion-mcp@0.3.1
```

**Building from source?**
```bash
git pull && pnpm install && pnpm build
```

Then **restart your MCP client** so it spawns the new server. Your existing candidates, judge, personas, and keys are preserved — config upgrades happen automatically on load (a one-time notice prints to stderr). No data migration required.

> **First time?** Run `npx openfusion-setup` to register OpenFusion with your client and install the agent skill, then open `http://localhost:9077` to configure candidates + a judge + keys — or just head straight to the **Playground** tab and try a fusion.

---

## Compatibility

- **Node.js ≥ 22** (unchanged).
- **No breaking config changes.** Config schema migrates automatically (v4 → v5 on load if you're coming from 0.3.0).
- Existing MCP-client workflows (Claude Code, Cursor, Zed, Codex, etc.) are unchanged — the Playground is an *additional* way to launch fusions.

---

## Feedback

Found a bug or have an idea? [Open an issue](https://github.com/hashangit/openfusion/issues). PRs welcome — see `CONTRIBUTING.md`.

---

*OpenFusion brings OpenRouter's Fusion panel architecture to any MCP-capable client — and now, to your browser too. Frontier-grade answers from any mix of models, on your machine, no lock-in.*
