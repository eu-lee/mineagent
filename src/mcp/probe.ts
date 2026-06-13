/** Boots the MCP server with stub deps and lists tools over HTTP.
 *  Validates the express + MCP SDK wiring without a running Minecraft.
 *  Usage: npx tsx src/mcp/probe.ts */
import { startMcpServer, type McpDeps } from "./server.js";
import { ActionGate } from "../bot/action-gate.js";
import { loadConfig } from "../config.js";

const cfg = loadConfig();

// Minimal stubs — tools/list only touches registration, not handlers.
const deps = {
  agent: { bot: {}, say: () => {} },
  actions: {},
  nav: {},
  gate: new ActionGate(),
  cfg,
} as unknown as McpDeps;

const port = await startMcpServer(new Map([["probe", deps]]), 0); // ephemeral port

const res = await fetch(`http://127.0.0.1:${port}/mcp/probe`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
});

const text = await res.text();
// Streamable HTTP returns SSE framing; extract the JSON data line.
const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
const payload = dataLine ? JSON.parse(dataLine.slice(5)) : JSON.parse(text);
const tools = payload.result?.tools ?? [];

console.log(`MCP server returned ${tools.length} tools:`);
for (const t of tools) console.log(`  - ${t.name}`);

console.log(tools.length >= 14 ? "\nPROBE OK" : "\nPROBE FAILED (expected >=14 tools)");
process.exit(tools.length >= 14 ? 0 : 1);
