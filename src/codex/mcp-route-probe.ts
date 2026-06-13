/** Which path does codex's MCP client actually POST to — the -c override path
 *  or config.toml's path? Starts a logging HTTP server on 7699, spawns codex
 *  with `-c mcp_servers.mineagent.url=.../mcp/PROBE_MARKER`, triggers an MCP
 *  connect, and prints every path hit. Usage: npx tsx src/codex/mcp-route-probe.ts */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import http from "node:http";

const hits: string[] = [];
const srv = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  console.log(`[http] ${req.method} ${req.url}`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
});
srv.listen(7699, "127.0.0.1", () => console.log("[http] logging server on 7699"));

const TEST_URL = "http://127.0.0.1:7699/mcp/PROBE_MARKER";
const proc = spawn("codex", ["app-server", "-c", `mcp_servers.mineagent.url=${TEST_URL}`], {
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32",
});

let id = 0;
const send = (method: string, params?: unknown) =>
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
const notify = (method: string, params?: unknown) =>
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n");

proc.stderr.on("data", (d: Buffer) => process.stderr.write(`[stderr] ${d}`));
createInterface({ input: proc.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === 1 && "result" in msg) {
    notify("initialized");
    send("thread/start", { cwd: process.cwd(), sandbox: "workspace-write", approvalPolicy: "never" });
  }
});

send("initialize", { clientInfo: { name: "probe", title: "probe", version: "0" }, capabilities: null });

setTimeout(() => {
  const hitMarker = hits.some((h) => h.includes("PROBE_MARKER"));
  const hitPlain = hits.some((h) => h.includes("/mcp") && !h.includes("PROBE_MARKER"));
  console.log("\n=== paths hit ===\n" + (hits.join("\n") || "(none)"));
  if (hitMarker) console.log("\n✅ -c override WORKS — codex hit the PROBE_MARKER path");
  else if (hitPlain) console.log("\n❌ -c override IGNORED — codex hit config.toml's /mcp path");
  else console.log("\n⚠️ codex never connected to the MCP server (no /mcp hits at all)");
  proc.kill();
  srv.close();
  process.exit(0);
}, 12_000);
