# AI Ecosystem — README for AI agents

You are an AI coding agent (Claude Code, Codex, Cursor, Gemini CLI or similar) asked to set up, run, debug or change AI Ecosystem. This file is the operator's manual: what this is, every process and port, every model and where it comes from, the exact setup sequence with its expected output, and how to read every failure. Humans read [README.md](README.md). Everything below was checked against the code in this repository; if this file and the code ever disagree, the code wins, and you should fix this file in the same change.

## 0. Hard rules

1. **One model slot. 8 GB RAM.** The target machine is a Surface Pro 6 with 8 GB RAM. Only ONE Ollama model may be loaded. All agents queue through a single serialized promise chain (`server/llm.ts` — one inference at a time, by design, enforced). Never suggest running a second model, never set two models on the same machine, never raise `num_ctx` past 4096 without asking. The default model `qwen2.5:1.5b-instruct-q4_K_M` (~1.1 GB) is chosen for 24/7 stability, not quality.
2. **Agent tools are confined to `data/workspace/`.** `read_file`, `write_file` and `list_files` resolve paths with `safeJoin` and throw outside the workspace. Never loosen this. `run_shell` checks the FIRST WORD of the command against `shellWhitelist` in `config.json` and rejects any command containing `| < > & ; \` " \` or `\`. Keep the list tight when adding entries; never add `powershell`, `cmd`, `curl`, `del`, `rm`.
3. **Never commit machine-local state.** `data/` (the SQLite database `data/eco.db`, `data/logs/`, `data/workspace/`, `data/report.zip`), `config.json`, `workspace/`, `node_modules/`, `dist-server/`, `dist-client/` and `*.log`/`*.db*` are git-ignored. Ship `config.example.json` instead. Never `git add -f` any of them.
4. **`config.json` is the machine's, not git's.** `server/config.ts` writes it from defaults on first run if missing, then merges whatever the user saved. It holds the user's port, model choice and shell whitelist. Edits to it must never be committed, and `update.bat` deliberately does NOT overwrite it (`git reset --hard` is safe precisely because this file is untracked).
5. **Do not disturb a running stack.** Default port is **8080** (HTTP + WebSocket on the same port), Ollama is **11434**. To inspect, use `GET /health`, `GET /api/diagnostics` — they start nothing. To experiment, use another port in a copy of `config.json`.
6. **Rebuild after every server edit.** The server runs compiled JS from `dist-server/`. `tsc -p tsconfig.server.json` (or `npm run build`) before any manual restart, or your edit silently does nothing. The browser bundle needs `vite build`.
7. **Structured output contract.** Agent tool calls are forced valid by Ollama's `format` parameter (JSON schema, `CALL_SCHEMA` in `server/agent.ts`). Never parse tool calls out of free text; extend the schema instead.
8. **Exact model-name matching.** `llm.hasModel()` compares `ollama list` names EXACTLY. `qwen2.5:1.5b-instruct-q4_K_M` does not match `qwen2.5vl:3b`, and prefix matching has caused a real bug before. When the user asks for a model by a fuzzy name, resolve it to the exact tag with `ollama list` first.

## 1. What this is

A god-eye 2D pixel office (pure Canvas 2D — no Phaser, no WebGL, no Chromium/Electron/Docker) where four AI workers sit at desks and execute tasks with real tools: reading and writing real files in `data/workspace/`, real web search, safe shell commands. Agents move, chat and have idle thoughts on their own, but the LLM only runs **at decision points** (event-driven cognition) — idle CPU is near zero, which is what makes 24/7 operation possible on weak hardware.

- Humans play it Sims-style: the whole office is always visible, nobody walks an avatar. They message the **Boss** (agent id 5) in the side panel — he answers questions, delegates real work to the workers, and is the only agent a human normally talks to. A click-on-agent direct task dialog remains as a power-user shortcut (the Boss never takes tasks).
- The world is a *view*. The headless core (`WorldSim`) runs with or without a browser; `start-headless.bat` runs it with none open.

## 2. Architecture: processes, ports

Everything is ONE Node process plus Ollama:

| process | script | port | health | talks to |
|---|---|---|---|---|
| the world (server + API + WebSocket + sim + tools + SQLite) | `node dist-server/server/main.js` (`--headless` for 24/7) | **8080** (from `config.json`) | `GET /health` | Ollama (11434), DuckDuckGo (web_search), the browser |
| the browser world | any browser at `http://localhost:8080` | — | — | the server (HTTP + WS `/ws`) |
| Ollama | installed separately, runs itself | **11434** | `GET /api/tags` | — |
| watchdog (optional) | Windows Scheduled Task `AIEcosystemWatchdog`, installed by `install-watchdog.bat` | — | checks port 8080 every minute | restarts via `watchdog.bat` when the port is dead |

HTTP routes the server answers:

| route | what |
|---|---|
| `/` | the pixel office (static, from `dist-client/`) |
| `GET /health` | `{ ok, model, ollama, modelLoaded, clients, headless }` — the one-glance check |
| `GET /api/state` | agents snapshot, task counts, recent tasks, events, skills |
| `GET /api/tasks` / `POST /api/tasks` | list recent tasks / assign one `{ agentId, title, body }` (Boss id 5 rejected by the sim) |
| `POST /api/boss` | `{ text }` → `{ ok: true }` immediately; the Boss's reply arrives over WS as `{ type: 'boss', text, ts }` and as a speech bubble in the office |
| `GET /api/chats` | the human ↔ Boss chat history (`chats` table, rotated to newest 500 rows) |
| `GET /api/events` | recent event log |
| `GET /api/diagnostics` | version, uptime, node version, platform, RSS memory, config, health, crash-file list, last 80 log lines — everything a bug report needs |
| `GET /api/update` | current vs. latest version from the auto-updater |
| `WS /ws` | live world stream (agents + task counts + events + boss replies) |

Data layout (all under `data/`, all git-ignored):

| path | what |
|---|---|
| `data/eco.db` (+ `-shm`, `-wal`) | SQLite in WAL mode. Tables: `agents`, `tasks`, `memories`, `events`, `chats`. `events` rotates to the newest 2000 rows, `chats` to the newest 500, so the DB cannot grow forever |
| `data/workspace/` | the ONLY folder agent tools can touch |
| `data/logs/server.log` | every console line, timestamped, rotated at ~1 MB (`server.log.1`) |
| `data/logs/crash-*.json` | one JSON per crash: kind, message, stack, version, uptime, last 50 log lines |
| `data/report.zip` | what `report-log.bat` produces for the developer |

## 3. Repository map

| path | role |
|---|---|
| `server/main.ts` | entrypoint: express + WS + sim loop (4 Hz tick), routes, boot health check, crash handlers |
| `server/config.ts` | loads `config.json` (writes defaults if missing). **GOTCHA: `ROOT` is computed as two `dirname` levels up from the compiled file** — compiled output lives at `dist-server/server/config.js`, so root is `import.meta.dirname/../../`. Getting this wrong silently makes `data/` appear inside `dist-server/` |
| `server/llm.ts` | the ONE model slot: serialized chat queue, `format` = JSON schema, 120 s timeout, exact-match `hasModel` |
| `server/agent.ts` | the task runner: builds the prompt, parses the forced-JSON tool call, runs tools in a loop, writes the result to the task row |
| `server/boss.ts` | the Boss (agent id 5): builds an office-aware prompt (workers, tasks, events, chats, workspace listing), forces `{ reply, tasks[] }` JSON, delegates via `db.addTask` + `sim.assign` |
| `server/tools.ts` | sandboxed tools (§0 rule 2). `FORBIDDEN_CHARS` regex + first-word whitelist for `run_shell` |
| `server/world.ts` | `WorldSim`: movement, desks, pathfinding, task assignment, idle thoughts, agent chat. Guards: the Boss never receives tasks and never idles/chats |
| `server/db.ts` | better-sqlite3, WAL, migrations inline |
| `server/skills.ts` | loads every `skills/*.json`, matches skills to task text by word overlap (top 2), injects their `instructions` (cut to 600 chars) into the prompt |
| `server/logs.ts` | console capture → ring buffer + `data/logs/server.log`; `writeCrash()` → `data/logs/crash-*.json` |
| `server/updater.ts` | version check (§7). Never downloads anything — it only reports |
| `server/net.ts` | WS hub: world broadcast + event broadcast + boss-reply broadcast, client count |
| `client/` | the pixel world: `main.ts` (god-eye loop, click-to-select, Boss chat panel, update banner), `render.ts` (Canvas 2D, whole map fitted at one fixed scale, name tags/bubbles in screen space), `net.ts`, `move.ts` (legacy walking module, unused by main) |
| `shared/types.ts`, `shared/map.ts`, `shared/sprites.ts` | types, tile map, pixel sprites shared by both sides |
| `skills/` | skill manifests, JSON only (§9). `skills/README.md` documents the format |
| `scripts/make-report.mjs` | collects crash logs + log tail + live diagnostics into `data/report/` |
| `start.bat` / `start-headless.bat` | user launchers (open browser / no browser) |
| `watchdog.bat` / `install-watchdog.bat` / `remove-watchdog.bat` | 24/7 supervision |
| `update.bat` | §7 |
| `report-log.bat` | §8 |
| `config.example.json` | the shipped template; `config.json` is generated per machine |
| `council-report-2026-11-15.html`, `council-transcript-2026-11-15.md` | the architecture decision record (an "LLM council" of 5 advisors debated and peer-reviewed the design) |

## 4. Models: what, from where, how it is checked

| model | used for | source | size | lands in | checked by |
|---|---|---|---|---|---|
| `qwen2.5:1.5b-instruct-q4_K_M` (default) | all agent thinking | Ollama registry (`ollama pull`) | ~1.1 GB | Ollama's own store | `GET /health` → `modelLoaded: true` (exact tag match) |
| `qwen2.5:3b-instruct-q4_K_M` (`bigModel` in config) | optional upgrade | Ollama registry | ~1.9 GB | Ollama's own store | same |

There is no third model slot. `num_ctx` is 2048, `num_predict` 300, temperature 0.3 — sized so a 1.5B model with the full agent prompt stays fast on 8 GB. `keepAlive` 5m so the model stays warm between tasks.

Rule from §0 applies: one model at a time. If the person's machine has 16+ GB and they WANT a bigger model, the only correct move is editing `"model"` in `config.json` to the exact tag after `ollama pull <tag>` — never running two.

## 5. Setup, step by step

Prerequisites: Windows 10/11; Node.js ≥ 20 (`node -v`); Ollama installed and running (`ollama list` works); git (for updates); ~3 GB free disk. The target machine has no GPU — this is fine, everything is CPU.

### 5.1 Clone

```
git clone https://github.com/bluerivernight/ai-ecosystem.git
cd ai-ecosystem
```

### 5.2 Pull the model

```
ollama pull qwen2.5:1.5b-instruct-q4_K_M
```

Expected final lines: `pulling manifest` … progress bars … `success`. Verify with `ollama list` — the row must read exactly `qwen2.5:1.5b-instruct-q4_K_M` (§0 rule 8).

### 5.3 Install and build

```
npm install
npm run build
```

Expected: `npm install` finishes without red errors (npm may ask to approve build scripts for `better-sqlite3` and `esbuild` — approve them; `package.json`'s `allowScripts` field already whitelists both). `npm run build` prints the tsc step (silence = success), then vite: `✓ 9 modules transformed` and the two bundle lines (`dist-client/index.html`, `dist-client/assets/index-*.js`).

### 5.4 Windows settings (skip only if the machine never sleeps)

- Settings → System → Power → **Sleep: Never** (plugged in), keep it plugged in.
- If Windows blocks a `.bat`: **More info → Run anyway** — these are plain local scripts, they download nothing.

### 5.5 Start

Double-click `start.bat` (browser opens at `http://localhost:8080`) or `start-headless.bat` (no browser, for 24/7), or from a terminal `npm start`.

Expected console (start):

```
[skills] loaded 2 skill(s)
[boot] AI Ecosystem server on http://localhost:8080 (headless)
[boot] workspace: <project>\data\workspace
[boot] model ready: qwen2.5:1.5b-instruct-q4_K_M
```

(An existing database from before v1.1.0 instead prints `[boot] added Boss to the existing office` — that migration is correct and automatic. On first run before the model check completes you may instead see `[boot] model missing — run: ollama pull …`, or `[boot] Ollama not reachable` — see §6.)

Expected: browser shows a pixel office with 5 agents (Nova, Rex, Pixel, Byte and the gold 👑 Boss, drawn bigger), the Boss chat panel on the left, task counts and a ticking event log. Verify end to end:

```
curl http://localhost:8080/health
→ {"ok":true,"model":"qwen2.5:1.5b-instruct-q4_K_M","ollama":true,"modelLoaded":true,...}
```

Then talk to the Boss (the normal human path):

```
curl -X POST http://localhost:8080/api/boss -H "Content-Type: application/json" -d "{\"text\":\"Please have someone write hello.txt containing the word hi\"}"
```

Expected within ~20–60 s: `GET /api/chats` contains the user line and the Boss reply, the event log shows `Boss delegated to <worker>: …`, `GET /api/tasks` shows the delegated task(s) reaching **done**, and `data/workspace/hello.txt` exists on disk. (The direct path still works too: `POST /api/tasks` with `{ agentId: 1, ... }`.) If the file exists, the whole stack works: browser → API → Boss → queue → LLM → tools → filesystem.

## 6. How to read every failure

| you see | it means | fix |
|---|---|---|
| `/health` → `"ollama": false` | Ollama is not running | start Ollama (it should auto-start; or run `ollama serve`) |
| `/health` → `"modelLoaded": false` | Ollama runs, model tag wrong or not pulled | `ollama list` and compare the tag EXACTLY; `ollama pull qwen2.5:1.5b-instruct-q4_K_M` |
| task fails with `Ollama HTTP 404` | the model name in `config.json` does not exist in Ollama (exact-match rule) | same as above — 404 from Ollama is ALWAYS the model name |
| `EADDRINUSE` / port error on boot | something else owns 8080 | change `"port"` in `config.json`, restart |
| boot prints `dist-client/ missing` | client not built | `npm run build` |
| boot prints `Ollama not reachable — agents will idle` | same as `ollama:false`; server still runs, agents idle | start Ollama; no restart needed once it's up |
| tasks stuck `queued` forever | (historical bug) server predates the `sim.assign()` fix in `main.ts` | update — current code assigns on `POST /api/tasks` |
| `data/` appears inside `dist-server/` | (historical bug) `ROOT` computed wrongly in `config.ts` | update — current code resolves two levels up from the compiled file |
| `NODE_MODULE_VERSION mismatch` or better-sqlite3 crash | native module built for another Node | `npm rebuild better-sqlite3` (or delete `node_modules`, `npm install` again) |
| npm refuses to run build scripts | npm's script-blocking prompt not answered | approve `better-sqlite3` and `esbuild`, reinstall |
| first task takes 20+ s | normal — model cold-load | nothing; later tasks are faster |
| everything died overnight | Windows slept the machine | §5.4 |
| `.js` import errors when running `tsc` directly on new code | server code is ESM with explicit `.js` import extensions | follow the existing style: `from './config.js'`, never extensionless |

Rule of thumb: everything the server logs also lands in `data/logs/server.log`, and any uncaught exception additionally produces `data/logs/crash-*.json` (§8). Read those first when debugging a machine you can't sit at.

## 7. Updating the app (the auto-updater)

The server checks the GitHub repo's `package.json` (`updateUrl` in `config.json`, default `https://raw.githubusercontent.com/bluerivernight/ai-ecosystem/main/package.json`) on boot and every 6 hours. It never downloads or applies anything itself.

- Newer version found → the browser shows an orange banner at the bottom: "⬆ New version X available — run update.bat".
- `/api/update` returns `{ current, latest, updateAvailable, checkedAt, error, url }`. Offline machines just keep the last state; `error` records the reason and is NOT a crash.

Applying an update (`update.bat`, or as an agent):

```
git fetch origin
git reset --hard origin/main
npm install
npm run build
```

Safe to run while `config.json`, `data/` and `workspace/` exist — all untracked, untouched by the reset. Note `git reset --hard` DOES discard any tracked-source edits made locally on the machine; if someone edited server code there, warn them first.

To release a new version yourself: bump `"version"` in `package.json`, push to `main`. Every running install notices within 6 hours (or at its next boot).

## 8. Crash logs and bug reports

- Every console line (info/warn/error) is captured to `data/logs/server.log` with a timestamp. Rotates at ~1 MB, keeps one old copy.
- `uncaughtException` → writes `data/logs/crash-<timestamp>.json` (kind, message, stack, version, uptime, last 50 log lines) then shuts down cleanly. `unhandledRejection` → same file, but the server KEEPS RUNNING (deliberate: one bad promise must not kill the world).
- `GET /api/diagnostics` is the one-glance state dump: version, uptime, node, platform, RSS, effective config, health, crash-file list, last 80 log lines.
- `report-log.bat` (double-click) runs `scripts/make-report.mjs`, which copies the 10 newest crash reports, the log tail, machine info and (if the server is running) live diagnostics into `data/report/`, then zips it to `data/report.zip` and opens Explorer with the file selected. The user sends that one file. No manual log-diving needed.

When the person reports a bug: ask for `data/report.zip` first, or, if they can paste instead, the output of `curl http://localhost:8080/api/diagnostics`.

## 9. Skills

`skills/*.json`, one manifest per file:

```json
{
  "name": "meeting-notes",
  "description": "How to take meeting notes",
  "keywords": ["meeting", "notes", "minutes"],
  "instructions": "You are taking meeting notes. Always produce..."
}
```

- Required fields: `name`, `description`, `instructions`. Invalid JSON or missing fields → logged and skipped (the server still boots).
- Matching: word overlap between task text and `name` + `description` + `keywords`, top 2 wins. No match → no skill injected.
- `instructions` are cut to 600 chars in the prompt (tiny context windows). Keep them imperative and short.
- Adding one requires only a restart (`node dist-server/server/main.js` reloads skills at boot).
- `skills/README.md` is the human-facing format doc; keep the two in sync.

## 10. Verification checklist

Run all of these after any change; all must pass before you claim done:

1. `npm run build` — zero errors.
2. Start the server (headless), then:
   - `curl http://localhost:8080/health` → `"ollama":true,"modelLoaded":true`
   - `curl http://localhost:8080/api/diagnostics` → has `version`, `recentLog` non-empty
   - `curl http://localhost:8080/api/update` → `current` matches `package.json`
3. POST `/api/boss` (§5.5) → Boss reply lands in `/api/chats`, a delegation event appears, the delegated task reaches `done`, the result file exists in `data/workspace/`.
4. Open `http://localhost:8080` in a browser → whole office visible (5 agents, Boss gold and bigger), Boss chat panel works, event log ticks, no console errors.
5. `data/logs/server.log` contains your session's boot lines.
6. `git status` shows no `data/`, `config.json`, `dist-*` or `node_modules` staged.
