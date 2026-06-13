/** Protocol probe: verify initialize + thread/start work against the installed
 *  codex app-server. No turn is started, so no model tokens are spent.
 *  Usage: npx tsx src/codex/probe.ts */
import { CodexAppServerClient } from "./app-server-client.js";
import { repoRoot } from "../config.js";

const client = new CodexAppServerClient({
  command: "codex",
  cwd: repoRoot,
  model: null,
  sandbox: "workspace-write",
});

try {
  console.log("starting app-server + initialize...");
  await client.start();
  console.log("initialize OK");

  const threadId = await client.startThread();
  console.log("thread/start OK, threadId =", threadId);

  console.log("\nPROBE OK — protocol framing validated");
} catch (err) {
  console.error("\nPROBE FAILED:", err);
  process.exitCode = 1;
} finally {
  client.stop();
  setTimeout(() => process.exit(), 200);
}
