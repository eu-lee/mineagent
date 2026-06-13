import { loadConfig, repoRoot } from "./config.js";
import { AgentBot } from "./bot/agent-bot.js";
import { Navigator } from "./bot/navigator.js";
import { Actions } from "./bot/actions.js";
import { ActionGate } from "./bot/action-gate.js";
import { startMcpServer } from "./mcp/server.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { Orchestrator } from "./orchestrator.js";

const cfg = loadConfig();

// --- Bot + action layer ---
const agent = new AgentBot(cfg);
await agent.start();
const nav = new Navigator(agent.bot);
const actions = new Actions(agent.bot, nav);
const gate = new ActionGate();

// --- MCP server (Codex's hands) ---
await startMcpServer({ agent, actions, nav, gate, cfg });

// --- Codex brain ---
const codex = new CodexAppServerClient({
  command: cfg.codex.command,
  cwd: repoRoot,
  model: cfg.codex.model,
  sandbox: cfg.codex.sandbox,
});

try {
  await codex.start();
  const orchestrator = new Orchestrator(cfg, agent, codex, gate, nav);
  orchestrator.start();
  console.log(`[mineagent] ready — say "${cfg.chat.mention} <request>" in chat`);
} catch (err) {
  console.error("[mineagent] codex app-server unavailable, running in echo mode:", err);
  agent.onChat(({ username, message }) => {
    if (message.toLowerCase().startsWith(cfg.chat.mention)) {
      agent.say(`${username}: codex isn't running, but I heard you.`);
    }
  });
}

process.on("SIGINT", () => {
  codex.stop();
  agent.stop();
  process.exit(0);
});
