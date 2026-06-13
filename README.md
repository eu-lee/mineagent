# MineAgent

An LLM-driven Minecraft agent: **Codex** (via `codex app-server`) is the brain,
**mineflayer** is the body. Players command it in chat:

```
@agent come here
@agent collect 10 oak logs
@agent build me a pyramid
@agent stop
```

Simple requests use MCP tools directly; complex ones make Codex **write a skill
file** (`skills/<name>.ts`) and execute it via the `run_skill` tool, iterating
on errors — successful skills accumulate into a library.

## Setup

1. **Toolchain**: Node 22+, Java 21+ (for the local server), and the Codex CLI
   (`npm i -g @openai/codex`, then `codex login`).
2. **Install deps**: `npm install`
3. **A Minecraft server to join.** Two options:

   **A) Open to LAN (no Java/Paper needed).** In any Java client (Lunar Client,
   vanilla, …), open a singleplayer world, press `Esc` → **Open to LAN**, set
   **Game Mode: Creative** and **Allow Cheats: ON**, click start. It prints
   `Local game hosted on port NNNNN` in chat. The integrated server runs in
   offline mode, so the bot can join. The port changes every launch, so pass it
   via env var (below). After the bot joins, run `/op agent` in chat so its
   builder skills can `/give` materials.

   **B) Local Paper server** (offline mode, creative; needs Java 21+):
   ```powershell
   powershell -File server\setup.ps1     # downloads Paper, accepts EULA
   powershell -File server\paper\start.ps1
   ```
4. **Codex MCP wiring is automatic.** Each agent spawns its own
   `codex app-server` pointed at its own route
   (`http://127.0.0.1:<mcp.port>/mcp/<AgentName>`) via a `-c` config override, so
   you do **not** need `codex mcp add`. (A stray global `mineagent` entry in
   `~/.codex/config.toml` is harmless — it's overridden per agent.)
5. **Run the agents**: `npm run dev` — spawns `agents.count` bots named
   `Agent1..AgentN`; talk to each in-game with `@Agent1 <request>`, `@Agent2 …`.
   - For an Open-to-LAN world, pass the LAN port (and version if not the
     default) without editing `config.json`:
     ```powershell
     $env:MINEAGENT_PORT="NNNNN"; $env:MINEAGENT_VERSION="1.21.4"; npm run dev
     ```
   - Env overrides: `MINEAGENT_PORT`, `MINEAGENT_HOST`, `MINEAGENT_VERSION`.

## Config (`config.json`)

- `minecraft.auth`: `"offline"` for local dev; flip to `"microsoft"` to use a
  real account (device-code login, tokens cached). Only use on servers you own
  or have permission for — public-server anti-cheat may flag bot movement.
- `agents.count`: how many identical bots to spawn (`Agent1..AgentN`);
  `agents.namePrefix` changes the name stem; `agents.personality` is the shared
  brief; `agents.model` overrides the model (null = codex default).
- `chat.whitelist`: usernames allowed to command the bots. Empty = everyone (dev only!).
- `mcp.port`: the local port the per-agent MCP routes are served on.

## Development

- `npm run smoke` — scripted exercise of movement/dig/place primitives against
  the local server (needs creative for /give).
- `npm test` — unit tests (action gate, builder geometry).
- `npm run typecheck`

## Architecture

```
Minecraft chat ──► orchestrator ──► codex app-server (JSON-RPC/stdio)
                      │                  │ MCP tool calls
                      ▼                  ▼
                  mineflayer bot ◄── MCP server (http://127.0.0.1:7654/mcp)
                      ▲   goto/dig/place/observe/run_skill...
                      └── skills/*.ts (written by Codex, hot-loaded)
```

Key files: `src/orchestrator.ts` (chat↔Codex), `src/mcp/server.ts` (tools),
`src/bot/navigator.ts` (pathfinding + stuck watchdog), `src/skills/runtime.ts`
(hot-load skills), `AGENTS.md` (Codex's instructions).
