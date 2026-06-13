import { loadConfig, repoRoot, agentNames } from "./config.js";
import { AgentBot } from "./bot/agent-bot.js";
import { Navigator } from "./bot/navigator.js";
import { Actions } from "./bot/actions.js";
import { ActionGate } from "./bot/action-gate.js";
import { AutoEater } from "./bot/auto-eat.js";
import { Survival } from "./bot/survival.js";
import { startMcpServer, type McpDeps } from "./mcp/server.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { Orchestrator } from "./orchestrator.js";

const cfg = loadConfig();
const names = agentNames(cfg);
const allNames = new Set(names.map((n) => n.toLowerCase()));

interface AgentStack {
  name: string;
  bot: AgentBot;
  nav: Navigator;
  actions: Actions;
  gate: ActionGate;
  codex: CodexAppServerClient;
  survival: Survival;
}

// --- Build each agent's bot + action layer; collect MCP deps per agent ---
const stacks: AgentStack[] = [];
const mcpDeps = new Map<string, McpDeps>();

for (const name of names) {
  const bot = new AgentBot(cfg, name);
  await bot.start();
  const nav = new Navigator(bot.bot);
  const actions = new Actions(bot.bot, nav);
  const gate = new ActionGate();

  const codex = new CodexAppServerClient({
    command: cfg.codex.command,
    cwd: repoRoot,
    model: cfg.agents.model,
    sandbox: cfg.codex.sandbox,
    name,
    mcpUrl: `http://127.0.0.1:${cfg.mcp.port}/mcp/${name}`,
    developerInstructions: [
      cfg.agents.personality,
      `Your in-game name is "${name}", one of several bot characters in this world. ` +
        `Every message relayed to you is ALREADY directed at you by a player (their "@${name}" prefix has been stripped) — ` +
        `just respond and act on it directly; never ask the player to address you by name.`,
    ].join("\n\n"),
  });

  const survival = new Survival(bot.bot, actions, nav, gate);

  mcpDeps.set(name, { agent: bot, actions, nav, gate, cfg });
  stacks.push({ name, bot, nav, actions, gate, codex, survival });

  if (cfg.agents.autoEat ?? true) new AutoEater(bot.bot, actions, gate).start();
}

// --- One MCP server hosting a route per agent ---
await startMcpServer(mcpDeps, cfg.mcp.port);

// --- Start each agent's Codex brain + orchestrator (in parallel so one slow/
//     failed app-server doesn't block the others) ---
await Promise.allSettled(
  stacks.map(async (s) => {
    const others = new Set([...allNames].filter((n) => n !== s.name.toLowerCase()));
    try {
      console.log(`[mineagent] ${s.name}: starting codex app-server...`);
      await s.codex.start();
      const orchestrator = new Orchestrator(cfg, s.bot, s.codex, s.gate, s.nav, others, s.survival);
      orchestrator.start();
      console.log(`[mineagent] ${s.name} READY — say "@${s.name} <request>" in chat`);
    } catch (err) {
      console.error(`[mineagent] ${s.name}: codex app-server unavailable:`, err);
      s.bot.onChat(({ username, message }) => {
        if (message.toLowerCase().startsWith(`@${s.name.toLowerCase()}`)) {
          s.bot.say(`${username}: my brain isn't running, but I heard you.`);
        }
      });
    }
  }),
);

console.log(`[mineagent] startup complete — ${stacks.length} agent(s): ${names.join(", ")}`);

process.on("SIGINT", () => {
  for (const s of stacks) {
    s.survival.stop();
    s.codex.stop();
    s.bot.stop();
  }
  process.exit(0);
});
