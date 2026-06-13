import type { Config } from "./config.js";
import type { AgentBot } from "./bot/agent-bot.js";
import type { ActionGate } from "./bot/action-gate.js";
import type { Navigator } from "./bot/navigator.js";
import { observe } from "./bot/observe.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";

const SESSION_IDLE_MS = 15 * 60_000;

interface Session {
  threadId: string;
  lastUsed: number;
  turnActive: boolean;
}

/**
 * Wires Minecraft chat to Codex: "@agent <request>" from a whitelisted player
 * becomes a user turn; agent messages stream back into chat.
 */
export class Orchestrator {
  private cfg: Config;
  private agent: AgentBot;
  private codex: CodexAppServerClient;
  private gate: ActionGate;
  private nav: Navigator;
  private sessions = new Map<string, Session>(); // per player

  constructor(cfg: Config, agent: AgentBot, codex: CodexAppServerClient, gate: ActionGate, nav: Navigator) {
    this.cfg = cfg;
    this.agent = agent;
    this.codex = codex;
    this.gate = gate;
    this.nav = nav;
  }

  start(): void {
    this.codex.on("event", (threadId: string, msg: { type: string; [k: string]: unknown }) => {
      this.onCodexEvent(threadId, msg);
    });

    this.agent.onChat(({ username, message }) => {
      void this.onChat(username, message).catch((err) => {
        console.error("[orchestrator] chat handling failed:", err);
        this.agent.say(`${username}: something went wrong (${err instanceof Error ? err.message : err})`);
      });
    });
  }

  private async onChat(username: string, message: string): Promise<void> {
    const mention = this.cfg.chat.mention.toLowerCase();
    if (!message.toLowerCase().startsWith(mention)) return;

    const whitelist = this.cfg.chat.whitelist;
    if (whitelist.length > 0 && !whitelist.includes(username)) {
      console.log(`[orchestrator] ignoring non-whitelisted player ${username}`);
      return;
    }

    const request = message.slice(mention.length).trim();
    if (!request) {
      this.agent.say(`${username}: yes? (say "${this.cfg.chat.mention} <what you want>")`);
      return;
    }

    // Fast path: stop aborts the current action AND interrupts the turn.
    if (/^(stop|halt|cancel|abort)[.!]?$/i.test(request)) {
      const wasBusy = this.gate.busyWith;
      this.nav.stop();
      this.gate.stop();
      const session = this.sessions.get(username);
      if (session?.turnActive) await this.codex.interrupt(session.threadId);
      this.agent.say(wasBusy ? `stopped (was: ${wasBusy})` : "nothing to stop");
      return;
    }

    const session = await this.getSession(username);
    if (session.turnActive) {
      this.agent.say(
        `${username}: I'm still working${this.gate.busyWith ? ` (${this.gate.busyWith})` : ""} — say "${this.cfg.chat.mention} stop" to interrupt.`,
      );
      return;
    }

    session.turnActive = true;
    session.lastUsed = Date.now();
    console.log(`[orchestrator] <${username}> ${request}`);

    const turn = [
      `[message from player "${username}" in Minecraft chat]`,
      request,
      "",
      "[current world state]",
      observe(this.agent.bot),
    ].join("\n");

    await this.codex.sendUserMessage(session.threadId, turn);
  }

  private onCodexEvent(threadId: string, msg: { type: string; [k: string]: unknown }): void {
    const session = this.findSession(threadId);

    switch (msg.type) {
      case "agent_message": {
        const text = (msg.message as string) ?? "";
        if (text.trim()) this.agent.say(text.trim());
        break;
      }
      case "turn_complete": {
        if (session) {
          session.session.turnActive = false;
          session.session.lastUsed = Date.now();
        }
        break;
      }
      case "error": {
        console.error("[codex] error event:", msg);
        if (session) session.session.turnActive = false;
        this.agent.say(`brain error: ${(msg.message as string) ?? "unknown"}`);
        break;
      }
    }
  }

  private findSession(threadId: string): { username: string; session: Session } | undefined {
    for (const [username, session] of this.sessions) {
      if (session.threadId === threadId) return { username, session };
    }
    return undefined;
  }

  private async getSession(username: string): Promise<Session> {
    const existing = this.sessions.get(username);
    if (existing && Date.now() - existing.lastUsed < SESSION_IDLE_MS) return existing;

    const threadId = await this.codex.startThread();
    const session: Session = { threadId, lastUsed: Date.now(), turnActive: false };
    this.sessions.set(username, session);
    return session;
  }
}
