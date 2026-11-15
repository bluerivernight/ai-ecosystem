# Council Transcript — 2026-11-15

## Original Question
"Council this and @caveman, you are an elite full-stack engineer + systems architect specializing in extremely constrained hardware and local-first multi-agent systems... Build a complete, production-ready 2D AI Agent Ecosystem that can run 24/7 on very low-end hardware (Surface Pro 6 class: Intel i5-8250U, 8 GB LPDDR3, Intel UHD Graphics 620, 256 GB NVMe). It must be 100% free."

## Framed Question
Design the tech stack and high-level architecture for a complete, production-ready 2D AI Agent Ecosystem running 24/7 on extremely low-end hardware: Surface Pro 6 class (Intel i5-8250U 4C/8T, 8 GB LPDDR3 shared with Intel UHD 620 iGPU, 256 GB NVMe, ~2–3 GB install+data budget). Requirements: pixel-art walkable 2D office world; 3–5 configurable local AI agents with desks, pathfinding, animations, status bubbles; task assignment by walking up + key press; agents execute REAL work (file ops, safe shell, free web research, code writing) via a tool protocol; per-agent persistent memory; skills folder; 100% free; 24/7 headless with low idle and crash auto-recovery; setup a non-programmer teenager can follow. Proposed stack: Vite + TypeScript + Phaser 3 (or pure Canvas 2D), Node.js backend, Ollama tiny quantized models, SQLite or JSON persistence, no Docker, single/few processes.

## Advisor Responses (anonymized as A–E during review)

### A — The Expansionist
Everyone's sizing this as "a toy with agents" — wrong frame. This is a self-hosting personal agent OS on a $150 machine, and the surface area is bigger than the brief.

The undervalued asset: **event-driven architecture over polling**. Don't run Ollama on a timer — batch and queue agent cognition. A 0.5–1.5B model fired only when an agent reaches a decision point (idle tick, task trigger, player interaction) keeps the Surface cool 95% of the time. That same queue is the seed of something bigger: an **offline-first agent scheduler** that outlasts the demo. Nobody else has a validated pattern for "5 agents doing real tool work on 8 GB" — package the headless scheduler + tool protocol as an open-source core.

Adjacent opportunity #1: **the world is the UI**. Keep the world renderer and the agent runtime strictly separated (WebSocket messages only) and you've built a reusable "embodied agent viewer."

Adjacent opportunity #2: **skills folder = marketplace seed**. Skills as markdown/JSON manifests calling a documented tool protocol = a plugin format. Publish it.

Adjacent opportunity #3: **crash auto-recovery + 24/7 headless** is a lightweight autonomous-agent harness. Ship that as its module.

Pick: Phaser 3 yes, bet the upside on Ollama 0.5B-class models + SQLite WAL + "cognition is scheduled, not continuous" loop.

### B — The Outsider
The 8 GB is the whole project, and Ollama with 3–5 agents is where it dies. Windows eats 2.5–3 GB before you start. The fix is subtraction:
- One model at a time. All agents queue through it. Turn-taking is more believable anyway.
- 0.5B–1.5B models only. phi-3-mini is a luxury that guarantees thrashing.
- Don't run Ollama 24/7 — keep-alive=0 or a supervisor that sleeps the process after quiet minutes.
- Kill the browser. Use a native window with WebView2 (already on Windows, no Chromium download). Electron is worse.
- SQLite, not JSON files.
- Crash recovery needs a watchdog OUTSIDE your app (Windows Task Scheduler + restart script).

### C — The First Principles Thinker
You're asking the wrong question. The real question: how much inference can 8 GB sustain, and how do we architect so the AI almost never runs? The machine can host ONE small model. Agents are event-driven state machines that occasionally ask the model a question.

Invert the architecture: the core is a headless job runner (task queue → SQLite WAL → sandboxed tool executor → event log); the 2D world is a client view of that state. That's what makes 24/7 headless trivial.

Kill Phaser: a tilemap office is Canvas 2D, ~1,500 lines, A* on a grid. Phaser costs bundle size, RAM, a dependency, zero benefit.

Production-ready = Node single process, .bat-loop watchdog, SQLite WAL, OLLAMA_NUM_PARALLEL=1, capped context and num_predict. The real product is the queue and tool protocol; the pixel office is marketing. Build in that order.

### D — The Contrarian
The fatal flaw: the premise that 0.5B–2B models can execute real work via a tool protocol. qwen2.5-0.5b produces malformed JSON tool calls; phi-3-mini hallucinates file paths and shell flags. Budget a single 3B-class instruct model (qwen2.5-3b Q4 ≈ 1.9 GB), one agent thinking at a time.

The memory math doesn't close — Phaser+Chromium/Electron (2–3 GB) + Node + Ollama + model weights + KV cache + Windows = paging within minutes. If headless 24/7, don't run the game loop at all — render on demand. Cold-load is 10–30 s. Never run `vite dev` 24/7 — build static, serve with one lightweight Node process.

Concrete fix: pure Canvas 2D, strict schema-validated tool protocol with whitelisted commands, one model / one inference slot / agents queue. If a 3B doesn't fit, accept a 1.5B agent writes summaries, not production code — and say so in the docs instead of pretending.

### E — The Executor
1. Drop Phaser. Pure Canvas 2D. Vanilla TS + a 60-line A*.
2. ONE Node process: Express + `ws` serving static frontend, agent loop, tool runner, SQLite (better-sqlite3, sync API — JSON files corrupt under 24/7 writes). Ollama over its local HTTP API.
3. Model: qwen2.5:1.5b-instruct-q4_K_M default workhorse (~1.1 GB); phi-3-mini and gemma2-2b as configurable fallbacks; enforce one model slot.
4. Tool protocol = Ollama's native tool calling: read_file, write_file, run_shell (whitelisted), web_fetch (DuckDuckGo HTML). No LangChain — a while-loop with step cap and token cap.

Build against: agent loops (hard step cap), Ollama crash (node-windows or scheduled-task watchdog), idle CPU burn (30fps cap visible, halt rendering headless; agents run on timers, not the game loop).

First step: three files (main.ts, agent.ts, world.ts), one agent walking to a desk writing a file via Ollama by end of day one. Setup = winget install Ollama + ollama pull qwen2.5:1.5b + double-click start.bat.

## Peer Reviews

### Reviewer 1
Strongest: D — attacks the load-bearing premise (tool-call reliability) that A, C, E assume works; D's only flaw is contradicting B on persistence (one JSON file is riskier than SQLite WAL under 24/7). Biggest blind spot: E — never tests its riskiest assumption, ignores headless RAM question. All missed: constrained decoding (Ollama structured output `format` with JSON schema would force schema-valid tool calls and resolve the D-vs-E dispute), no measurement plan, timeout/retry semantics for cold-loads, DuckDuckGo fragility.

### Reviewer 2
Strongest: E — the only response ending in a Monday-morning artifact; correct stack details (better-sqlite3 rationale, native tool calling, three failure modes as day-one requirements). Biggest blind spot: D — answers a question nobody asked; "accept summaries not production code" concedes the core requirement; its one-JSON-file persistence contradicts its own 24/7 mandate. All missed: thermal/num_thread tuning, first-run UX verification (SmartScreen, memory dialogs), state migration/versioning.

### Reviewer 3
Strongest: B — attacks the binding constraint with real arithmetic and makes the two decisive calls (one model slot + queue, WebView2 over Chromium/Electron). C is best architecture and should merge with B. Biggest blind spot: E — silently assumes native tool calling works on 1.5B Q4 (exactly D's failure), no memory-budget math, watchdog contradicts B's out-of-process point. All missed: power/thermal reality, security/kill-switch design, unbounded event-log growth, measurement-first spike, newer 2026 small models.

### Reviewer 4
Strongest: C — inverting to a headless job runner with the world as a view solves 24/7, idle power, and crash recovery as side effects; E close second. Biggest blind spot: D — undated overconfident failure-rate claims; self-contradiction on persistence; "render on demand" contradicts walkable-office UX. All missed: setup verification & failure UX, thermal/power reality, prompt context budget math, Windows sleep/hibernate policy.

### Reviewer 5
Strongest: E — buildable plan with concrete mitigations. Biggest blind spot: A — never engages the hardware math; product fantasy layered on an unsolved runtime question; no word on tool reliability. All missed: thermal throttling under 24/7 load, sandbox security for run_shell, web research fragility.

## Chairman's Verdict

### Where the Council Agrees
1. One model slot, one inference at a time. B, C, D, E converged independently.
2. Drop Phaser. Pure Canvas 2D. No Chromium, no Electron — static build served by the same Node process.
3. Event-driven cognition, not continuous loops. Agents are state machines that occasionally invoke the model. Ollama does not run hot 24/7.
4. SQLite with WAL, not JSON files. better-sqlite3.
5. The headless job runner is the core; the 2D world is a view of its state.
6. Crash recovery lives outside the app — Task Scheduler / .bat watchdog.
7. Single Node process, no Docker, no microservices.

### Where the Council Clashes
Model class: 1.5B workhorse (B, E) vs 3B minimum (D). E optimizes for fit; D for capability. Both are right about their failure mode. Resolution: Ollama structured output (`format` with JSON schema) forces schema-valid tool calls by construction, dissolving most of the dispute. Make the model a config entry; measure; swap to 3B if needed — the budget has room for exactly that one swap.

### Blind Spots the Council Caught
1. Constrained decoding (structured output) — the most valuable idea of the review round.
2. Windows power policy kills "24/7" before software does — disable sleep on AC as a setup step.
3. Thermal throttling — OLLAMA_NUM_PARALLEL=1, num_thread=4 physical cores, event-driven loop.
4. First-run UX untested — SmartScreen, dialogs, model download; walk the first error.
5. Security/kill-switch — agents confined to project data folder, shell whitelist, kill switch, step/token caps, event-log rotation.
6. Context budget math — memory injection must be ranked and truncated, not dumped.
7. Event-log growth — rotation/capping needed on 256 GB.
8. Web research fragility — cache results; degrade offline.
9. Measurement discipline — benchmark on real hardware; timeout/retry around cold-loads.

### The Recommendation
Build: one Node process, headless-first job-runner core, Canvas 2D view, better-sqlite3 (WAL), watchdog outside the process. Model: qwen2.5:1.5b-instruct-q4_K_M default, config-file entry, structured output ON. Swap to 3B only if measured quality fails. Document real capability limits after measuring. Setup is part of the product (winget → pull → start.bat → disable-sleep → troubleshooting page). Security floor day one: path whitelist, shell whitelist, kill switch, budgets, log rotation. Ship skills format + tool protocol as documented open artifacts.

### The One Thing to Do First
Two-hour spike on the actual Surface Pro 6, headless, before any game code: Ollama + qwen2.5:1.5b-instruct-q4_K_M, 20-call loop under a JSON schema via `format`, execute tool calls, record success rate / latency / peak memory with keep-alive off. If 1.5B + schema clears ~80% valid-executable tool calls, the architecture is settled; if not, swap to 3B knowing the budget survives it.
