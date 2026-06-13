/** List models the installed codex offers. Usage: npx tsx src/codex/model-probe.ts */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const proc = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32" });
let id = 0;
const send = (method: string, params?: unknown) =>
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
const notify = (method: string) => proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");

proc.stderr.on("data", (d: Buffer) => process.stderr.write(`[stderr] ${d}`));
createInterface({ input: proc.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === 1 && "result" in msg) { notify("initialized"); send("model/list", {}); }
  else if (msg.id === 2) { console.log(JSON.stringify(msg.result ?? msg.error, null, 2)); proc.kill(); process.exit(0); }
});
send("initialize", { clientInfo: { name: "probe", title: "probe", version: "0" }, capabilities: null });
setTimeout(() => { console.error("TIMEOUT"); proc.kill(); process.exit(1); }, 20_000);
