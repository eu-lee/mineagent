/** End-to-end debug: bot joins, MCP up, Codex runs ONE turn that must call an
 *  MCP tool. Logs every server-request + event so we can see approval/elicitation
 *  behavior and the tool result. Joins as "agent" — stop any other instance first.
 *  Usage: $env:MINEAGENT_PORT="NNNNN"; npx tsx src/codex/turn-probe.ts */
import { loadConfig, repoRoot } from "../config.js";
import { AgentBot } from "../bot/agent-bot.js";
import { Navigator } from "../bot/navigator.js";
import { Actions } from "../bot/actions.js";
import { ActionGate } from "../bot/action-gate.js";
import { startMcpServer } from "../mcp/server.js";
import { CodexAppServerClient } from "./app-server-client.js";

const cfg = loadConfig();
const agent = new AgentBot(cfg);
await agent.start();
const nav = new Navigator(agent.bot);
const actions = new Actions(agent.bot, nav);
const gate = new ActionGate();
await startMcpServer({ agent, actions, nav, gate, cfg });

const codex = new CodexAppServerClient({ command: cfg.codex.command, cwd: repoRoot, model: cfg.codex.model, sandbox: cfg.codex.sandbox });
await codex.start();
console.log("[probe] codex initialized");

codex.on("event", (threadId: string, msg: { type: string; [k: string]: unknown }) => {
  console.log(`[probe:event] ${msg.type}`, msg.type === "agent_message" ? msg.message : "");
  if (msg.type === "turn_complete" || msg.type === "error") {
    setTimeout(() => { codex.stop(); agent.stop(); process.exit(0); }, 500);
  }
});

const threadId = await codex.startThread();
console.log("[probe] thread:", threadId);
await codex.sendUserMessage(
  threadId,
  "Call the `observe` MCP tool now and report exactly what it returns. This is a connectivity test — you must actually invoke the tool.",
);
console.log("[probe] turn sent, waiting for events...");

setTimeout(() => { console.error("[probe] TIMEOUT"); codex.stop(); agent.stop(); process.exit(1); }, 90_000);
