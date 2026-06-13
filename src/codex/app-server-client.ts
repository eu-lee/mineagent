import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

/**
 * Client for `codex app-server` (JSON-RPC 2.0, line-delimited over stdio),
 * v2 thread/turn API. Verified against codex-cli 0.139.0 by generating the
 * protocol bindings (`codex app-server generate-ts`).
 *
 * To re-verify after a CLI upgrade:
 *   codex app-server generate-ts --experimental --out .codex-proto
 * and check ClientRequest.ts / ServerNotification.ts / ServerRequest.ts.
 *
 * Normalized events emitted (via EventEmitter):
 *   "event" (threadId: string, { type: "agent_message", message } |
 *                               { type: "turn_complete", status } |
 *                               { type: "error", message })
 *   "exit"  (code: number | null)
 */
export type NormalizedEvent =
  | { type: "agent_message"; message: string }
  | { type: "turn_complete"; status: string }
  | { type: "error"; message: string };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface CodexClientOptions {
  command: string; // e.g. "codex"
  cwd: string; // workspace the agent edits (the repo, for skill files)
  model?: string | null;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
}

export class CodexAppServerClient extends EventEmitter {
  private proc!: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private opts: CodexClientOptions;
  /** Latest active turn id per thread, for interrupts. */
  private activeTurns = new Map<string, string>();

  constructor(opts: CodexClientOptions) {
    super();
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.proc = spawn(this.opts.command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32", // codex is a .cmd shim on Windows npm installs
    });

    this.proc.on("exit", (code) => {
      this.emit("exit", code);
      const err = new Error(`codex app-server exited with code ${code}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
    this.proc.stderr.on("data", (d: Buffer) => {
      const text = d.toString().trim();
      if (text) console.error("[codex:stderr]", text);
    });

    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "mineagent", title: "MineAgent", version: "0.1.0" },
      capabilities: null,
    });
    this.notify("initialized");
  }

  stop(): void {
    this.proc?.kill();
  }

  // ---------------------------------------------------------------------
  // Public API (used by the orchestrator)
  // ---------------------------------------------------------------------

  /** Start a thread (one per player session); returns its id. */
  async startThread(): Promise<string> {
    const res = (await this.request("thread/start", {
      cwd: this.opts.cwd,
      sandbox: this.opts.sandbox,
      approvalPolicy: "never",
      ...(this.opts.model ? { model: this.opts.model } : {}),
    })) as { thread: { id: string } };
    return res.thread.id;
  }

  /** Send a user message as a new turn; events stream via "event". */
  async sendUserMessage(threadId: string, text: string): Promise<void> {
    await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
    });
  }

  /** Interrupt the active turn on a thread, if any. */
  async interrupt(threadId: string): Promise<void> {
    const turnId = this.activeTurns.get(threadId);
    if (!turnId) return;
    await this.request("turn/interrupt", { threadId, turnId }).catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Protocol adapter — notification/request method names from ServerNotification.ts
  // ---------------------------------------------------------------------

  private handleNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "turn/started": {
        const threadId = p.threadId as string;
        const turn = p.turn as { id: string } | undefined;
        if (threadId && turn) this.activeTurns.set(threadId, turn.id);
        break;
      }
      case "item/completed": {
        const item = p.item as { type: string; text?: string } | undefined;
        const threadId = p.threadId as string;
        if (item?.type === "agentMessage" && item.text) {
          this.emit("event", threadId, { type: "agent_message", message: item.text } satisfies NormalizedEvent);
        }
        break;
      }
      case "turn/completed": {
        const threadId = p.threadId as string;
        const turn = p.turn as { status?: string } | undefined;
        this.activeTurns.delete(threadId);
        this.emit("event", threadId, { type: "turn_complete", status: turn?.status ?? "completed" } satisfies NormalizedEvent);
        break;
      }
      case "error": {
        const threadId = p.threadId as string;
        const error = p.error as { message?: string } | undefined;
        this.activeTurns.delete(threadId);
        this.emit("event", threadId, { type: "error", message: error?.message ?? "unknown error" } satisfies NormalizedEvent);
        break;
      }
      default:
        // Many other notifications (deltas, plans, token usage, ...) — ignore.
        break;
    }
  }

  private handleServerRequest(id: number, method: string, params: unknown): void {
    // We run a trusted local MCP server with approvalPolicy=never, so
    // auto-approve everything Codex asks about.
    switch (method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        this.respond(id, { decision: "accept" });
        return;
      case "execCommandApproval":
      case "applyPatchApproval":
        this.respond(id, { decision: "approved" });
        return;
      case "mcpServer/elicitation/request":
        // Trusted local server — accept the prompt.
        console.error("[codex] elicitation request:", JSON.stringify(params));
        this.respond(id, { action: "accept", content: {}, _meta: null });
        return;
      case "item/tool/requestUserInput":
        this.respond(id, { input: null });
        return;
      default:
        console.error(`[codex] unhandled server request "${method}":`, JSON.stringify(params));
        this.respond(id, null, { code: -32601, message: `unhandled server request: ${method}` });
    }
  }

  // ---------------------------------------------------------------------
  // JSON-RPC plumbing
  // ---------------------------------------------------------------------

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("[codex] non-JSON line:", line.slice(0, 200));
      return;
    }

    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const pending = this.pending.get(msg.id as number);
      if (!pending) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const e = msg.error as { message?: string; code?: number };
        pending.reject(new Error(`codex rpc error ${e.code}: ${e.message}`));
      } else {
        pending.resolve(msg.result);
      }
    } else if ("id" in msg && "method" in msg) {
      this.handleServerRequest(msg.id as number, msg.method as string, msg.params);
    } else if ("method" in msg) {
      this.handleNotification(msg.method as string, msg.params);
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private notify(method: string, params?: unknown): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) }) + "\n");
  }

  private respond(id: number, result: unknown, error?: { code: number; message: string }): void {
    const msg = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
}
