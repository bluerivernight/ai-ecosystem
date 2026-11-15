# 🏢 AI Ecosystem — a pixel office full of tiny AI workers

A little 2D office you watch from above, Sims-style — the whole office is always
on screen. Inside are AI agents that sit at desks, do **real work** (write files,
search the web, run safe commands), remember what they did, and chat with each
other. Everything runs **100% on your computer** — no cloud, no subscriptions,
no API keys.

**You talk to the 👑 Boss.** He knows everything about the office and delegates
work to the workers — you never have to approach each agent one by one.

Built to run 24/7 on a weak laptop (like a Surface Pro 6 with 8 GB RAM).

---

## What you need before starting

| Thing | Why |
|---|---|
| **Node.js 20 or newer** | Runs the world. [nodejs.org](https://nodejs.org) → "LTS" version |
| **Ollama** | Runs the AI model, also on your PC |
| **Git** | So `update.bat` can fetch new versions later. [git-scm.com](https://git-scm.com) |

**Working on a fresh laptop?** Clone with `git clone https://github.com/bluerivernight/ai-ecosystem.git` instead of copying the folder — that way updates work from day one. Then follow the steps below in order.

## Setup (about 15 minutes, mostly waiting)

### Step 1 — Install Ollama

1. Go to [ollama.com/download](https://ollama.com/download) and install it.
   It starts itself in the background — you never have to look at it.
2. Open a **new** Command Prompt (press Start, type `cmd`, press Enter) and type:

   ```
   ollama pull qwen2.5:1.5b-instruct-q4_K_M
   ```

   This downloads the AI brain (~1 GB). Grab a snack. When it says "success", done.

> 💡 This project also works with slightly bigger models if your PC can handle
> them — see [Choosing a model](#choosing-a-model) at the bottom.

### Step 2 — Build the world

1. Open a Command Prompt **in this folder** (easiest: click the folder's address
   bar in File Explorer, type `cmd`, press Enter).
2. Type:

   ```
   npm install
   ```

   (one time only, downloads the code libraries)
3. Then:

   ```
   npm run build
   ```

### Step 3 — Stop Windows from ruining the 24/7 part ⚠️

This is the step everyone skips and then wonders why the office "stopped working"
at 2 AM. **Windows puts laptops to sleep.** That kills everything.

1. Settings → System → Power & battery
2. Set **"Sleep"** to **Never** (while plugged in)
3. Keep the laptop **plugged in**

### Step 4 — Start it

Double-click **`start.bat`**. A browser tab opens with the office.

**"It works" looks like:** 5 little people in the office (Nova, Rex, Pixel, Byte
and the gold 👑 Boss), event-log lines appearing on their own, and when you type
a message to the Boss in the side panel, he replies in seconds and (if you asked
for something to be done) agents walk to their desks and do it in under a minute
(the first one can take ~20 s extra — the AI brain is loading). That's it.

---

## Updates (like a normal app)

The office checks for a new version on its own. When one exists you'll see an
orange bar at the bottom of the page: **"New version available"**. Just:

1. Close the browser tab (so nothing is running).
2. Double-click **`update.bat`** — it grabs the new version and rebuilds.
3. Double-click `start.bat` again.

Your files, settings and workspace are never touched by an update.

## Something broke? Send me a log

Double-click **`report-log.bat`**. It collects the crash reports and recent logs
into one file — `data\report.zip` — and opens the folder with that file selected.
Send that single file and it's fixable.

---

## How to play

- **No walking — it's a god-eye view.** The whole office is always visible, like The Sims.
- **Message the Boss** in the side panel — he's the only one you talk to. Examples:
  - *"What's everyone working on?"* — he answers from what he knows
  - *"Please write a file with 5 startup ideas for a lemonade stand"* — he delegates to workers
  - *"Research the best cheap keyboards and save a digest"* — delegation again
- The Boss shows his reply as a speech bubble in the office, and workers walk to
  their desks, think, and use real tools (read/write real files, search the real
  web). Watch the bubbles and the event log.
- Power-user bonus: **click an agent on the map** to open a direct task dialog for
  that one agent (the Boss can't be given tasks — he gives them).
- Agents also chat with each other and have passing thoughts on their own.
  (They don't spam the AI — it only "thinks" at decision points, so idle CPU
  stays near zero.)

### What agents can actually do

| Tool | What it does | Safety |
|---|---|---|
| `read_file` / `write_file` / `list_files` | Files in `data/workspace/` only | Can't touch anything outside that folder |
| `run_shell` | Runs a few safe commands (`node`, `python`, `git`, `npm`, `dir`, `type`, `echo`) | Blocklist of dangerous characters + command whitelist |
| `web_search` | Real web search via DuckDuckGo (free) | — |

**Honest limits:** the default model is tiny (fits in 8 GB RAM). It writes
useful small files and notes, not production code. For better quality, see
[Choosing a model](#choosing-a-model).

---

## Running it 24/7 (headless)

The world runs with **no browser open** — the agents keep working in the
background at near-zero CPU.

1. Double-click **`start-headless.bat`** instead of `start.bat`.
   You can still check on it by opening `http://localhost:8080` in any browser.

2. (Recommended) Double-click **`install-watchdog.bat`** once — needs admin OK.
   It adds a Windows Scheduled Task that checks every minute and **restarts the
   world automatically if it ever crashes**. You can remove it later with
   `remove-watchdog.bat`.

---

## Adding your own agents

Edit `config.json`? No — agents live in the database, but the 4 workers + the
Boss are seeded on first run (and an older database gets the Boss added
automatically). To add more, edit the `DEFAULT_AGENTS` list in `server/main.ts`
before the first run, or ask your agents to do it for you later.

## Adding your own skills

Skills are **plain JSON files** in the `skills/` folder. See
[`skills/README.md`](skills/README.md). Drop a file in, restart, done.
They're just instruction cards — teenagers can write them.

---

## Choosing a model

The model is one line in `config.json`:

| Model | Size | Best for |
|---|---|---|
| `qwen2.5:1.5b-instruct-q4_K_M` (default) | ~1.1 GB | 8 GB RAM machines. Good enough for notes & small files |
| `qwen2.5:3b-instruct-q4_K_M` | ~1.9 GB | Noticeably smarter. Only if 8 GB machine feels stable |
| `qwen2.5:0.5b-instruct-q4_K_M` | ~0.4 GB | Very weak PCs. Quality drops a lot |

**Rule: only ONE model can be loaded at a time.** All agents share it and take
turns. Never install two big ones and try to run both — the 8 GB machine will
swap itself to death.

## Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows nothing / port in use | Another app has port 8080. Change `"port"` in `config.json` |
| Agents never do tasks | Open `http://localhost:8080/health`. If `ollama: false` → start Ollama. If `modelLoaded: false` → run the `ollama pull` command from Step 1 |
| "Windows protected your PC" when double-clicking a .bat | Click **More info → Run anyway** (it's your own script, no internet code) |
| First task takes 20+ seconds | Normal — the AI model loads into memory on first use. Later tasks are faster |
| Build fails with red text | Run `npm install` first, then `npm run build` again |
| Laptop slept and agents stopped | Do Step 3. Seriously. |

---

## How it works (for the curious)

One Node.js process does everything: serves the browser world, runs the agent
simulation (movement, desks, pathfinding), executes agent tools in a sandbox,
and stores everything in a local SQLite database. The pixel world is just a
*view* — the agents actually live in a headless task runner, so the world can
run 24/7 with or without anyone watching. The AI model runs in a separate
process (Ollama) and agents queue for it one at a time — the Boss and the
workers share the same one model slot.

Full tech-decision record: [`council-report-2026-11-15.html`](council-report-2026-11-15.html)
(an "LLM council" of 5 AI advisors debated and peer-reviewed this architecture).
