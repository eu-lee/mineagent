import type { Config } from "./config.js";
import type { AgentBot } from "./bot/agent-bot.js";
import type { ActionGate } from "./bot/action-gate.js";
import type { Navigator } from "./bot/navigator.js";
import { observe } from "./bot/observe.js";
import type { Survival } from "./bot/survival.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";

const SESSION_IDLE_MS = 15 * 60_000;

interface Session {
  threadId: string;
  lastUsed: number;
  turnActive: boolean;
}

/**
 * Wires one agent's Minecraft chat to its own Codex brain: "@<name> <request>"
 * from a whitelisted player becomes a user turn; agent messages stream back to
 * chat. Each agent is independent — it answers only to its own name and ignores
 * chat from the other agent bots (so they don't command each other in loops).
 */
export class Orchestrator {
  private cfg: Config;
  private agent: AgentBot;
  private codex: CodexAppServerClient;
  private gate: ActionGate;
  private nav: Navigator;
  private mention: string; // "@<name>" lowercased
  private otherAgents: Set<string>; // lowercased usernames to ignore
  private survival: Survival;
  private sessions = new Map<string, Session>(); // per player
  /** The task currently being executed, so we can resume it after a death. */
  private activeTask: { username: string; request: string; effort: string } | null = null;
  private deathResumes = 0;

  constructor(
    cfg: Config,
    agent: AgentBot,
    codex: CodexAppServerClient,
    gate: ActionGate,
    nav: Navigator,
    otherAgents: Set<string>,
    survival: Survival,
  ) {
    this.cfg = cfg;
    this.agent = agent;
    this.codex = codex;
    this.gate = gate;
    this.nav = nav;
    this.mention = `@${agent.username.toLowerCase()}`;
    this.otherAgents = otherAgents;
    this.survival = survival;
  }

  start(): void {
    this.codex.on("event", (threadId: string, msg: { type: string; [k: string]: unknown }) => {
      this.onCodexEvent(threadId, msg);
    });

    this.agent.onChat(({ username, message }) => {
      void this.onChat(username, message).catch((err) => {
        console.error(`[${this.agent.username}] chat handling failed:`, err);
        this.agent.say(`${username}: something went wrong (${err instanceof Error ? err.message : err})`);
      });
    });

    this.agent.onDeath(() => void this.onRespawn());
  }

  /** After dying and respawning, drop the broken action and resume the task. */
  private async onRespawn(): Promise<void> {
    const task = this.activeTask;
    if (!task) return;

    // Stop the stale action/turn left over from before death.
    this.nav.stop();
    this.gate.stop();
    const session = this.sessions.get(task.username);
    if (!session) return;
    if (session.turnActive) await this.codex.interrupt(session.threadId).catch(() => {});

    if (++this.deathResumes > 3) {
      this.activeTask = null;
      this.deathResumes = 0;
      session.turnActive = false;
      this.agent.say(`I keep dying trying that — giving up for now.`);
      return;
    }

    await new Promise((r) => setTimeout(r, 800)); // let the interrupt settle
    session.turnActive = true;
    session.lastUsed = Date.now();
    console.log(`[${this.agent.username}] resuming after death (try ${this.deathResumes}): ${task.request}`);
    await this.codex.sendUserMessage(
      session.threadId,
      this.framePlayerMessage(task.username, task.request, "you just DIED and respawned — resume this task from your current state"),
      task.effort,
    );
  }

  private async onChat(username: string, message: string): Promise<void> {
    // Ignore the other agent bots so they don't take orders from each other.
    if (this.otherAgents.has(username.toLowerCase())) return;

    // Accept messages addressed to this agent (@name) or to all agents
    // (@everyone). Every bot hears the chat, so each runs its @everyone copy.
    const lower = message.toLowerCase();
    const EVERYONE = "@everyone";
    let prefix: string;
    if (lower.startsWith(EVERYONE)) prefix = EVERYONE;
    else if (lower.startsWith(this.mention)) prefix = this.mention;
    else return;

    const whitelist = this.cfg.chat.whitelist;
    if (whitelist.length > 0 && !whitelist.includes(username)) {
      console.log(`[${this.agent.username}] ignoring non-whitelisted player ${username}`);
      return;
    }

    const request = message.slice(prefix.length).trim();
    if (!request) {
      this.agent.say(`${username}: yes? (say "@${this.agent.username} <what you want>")`);
      return;
    }

    // Fast path: toggle the background survival reflex (runs concurrently).
    const surviveMatch = /^survive\s+(on|off)$/i.exec(request);
    if (surviveMatch) {
      if (surviveMatch[1].toLowerCase() === "on") {
        this.survival.on();
        this.agent.say("survival on — I'll defend, flee, and heal while I work.");
      } else {
        this.survival.off();
        this.agent.say("survival off.");
      }
      return;
    }

    // Fast path: stop aborts the current action AND interrupts the turn.
    if (/^(stop|halt|cancel|abort)[.!]?$/i.test(request)) {
      const wasBusy = this.gate.busyWith;
      this.activeTask = null; // explicit stop cancels any death-resume
      this.deathResumes = 0;
      this.nav.stop();
      this.gate.stop();
      const session = this.sessions.get(username);
      if (session?.turnActive) await this.codex.interrupt(session.threadId);
      this.agent.say(wasBusy ? `stopped (was: ${wasBusy})` : "nothing to stop");
      return;
    }

    const session = await this.getSession(username);

    // If a turn is already running, fold the new message into it (steer) rather
    // than blocking — lets the player add info/redirect mid-task.
    if (session.turnActive) {
      try {
        const steered = await this.codex.steer(
          session.threadId,
          this.framePlayerMessage(username, request, "added this while you're still working — work it into what you're doing"),
        );
        if (steered) {
          session.lastUsed = Date.now();
          console.log(`[${this.agent.username}] <${username}> (steer) ${request}`);
          this.agent.say(`${username}: got it — folding that in.`);
          return;
        }
        session.turnActive = false; // turn just finished; fall through to a fresh one
      } catch (err) {
        console.error(`[${this.agent.username}] steer failed:`, err);
        this.agent.say(`${username}: I'm mid-task and couldn't fold that in — say "@${this.agent.username} stop" to redirect me.`);
        return;
      }
    }

    const effort = this.effortFor(request);
    session.turnActive = true;
    session.lastUsed = Date.now();
    this.activeTask = { username, request, effort };
    this.deathResumes = 0;
    // Acknowledge instantly so the player hears something now, instead of
    // waiting for the brain to finish reasoning (and often only chatting after
    // it has already run the action).
    this.agent.say(this.quickAck());
    console.log(`[${this.agent.username}] <${username}> [${effort}] ${request}`);

    await this.codex.sendUserMessage(
      session.threadId,
      this.framePlayerMessage(username, request, "in Minecraft chat, addressed to you — act on it"),
      effort,
    );
  }

  /**
   * Pick reasoning effort for a request: deep thinking only for builds and hard
   * tasks, snappy "low" for ordinary chat/commands. Effort is locked when a turn
   * starts (Codex can't deepen a turn mid-flight), so we infer it from the ask.
   */
  private effortFor(request: string): string {
    const r = this.cfg.agents.reasoning;
    const simple = r?.simple ?? "low";
    const complex = r?.complex ?? "high";
    const COMPLEX =
      /\b(build|rebuild|construct|design|architect|blueprint|tower|house|castle|fort|fortress|mansion|cabin|base|pyramid|statue|sculpture|monument|bridge|dome|maze|labyrinth|arena|stadium|wall|rampart|moat|farm|redstone|contraption|mechanism|machine|circuit|plan|strateg|optimi|calculate|complex|elaborate|intricate|skill)\b/i;
    if (COMPLEX.test(request) || request.length > 200) return complex;
    return simple;
  }

  /** A short, varied "heard you" so the player gets feedback immediately. */
  private quickAck(): string {
    const acks = ["on it", "got it", "sure thing", "okay!", "yep, on it", "👍 working on it"];
    return acks[Math.floor(Math.random() * acks.length)];
  }

  /** Frame a player message with a context tag + fresh world snapshot. */
  private framePlayerMessage(username: string, request: string, tag: string): string {
    return [
      `[message from player "${username}" ${tag}]`,
      request,
      "",
      "[current world state]",
      observe(this.agent.bot),
    ].join("\n");
  }

  private onCodexEvent(threadId: string, msg: { type: string; [k: string]: unknown }): void {
    const session = this.findSession(threadId);
    if (!session) return; // not this agent's thread

    switch (msg.type) {
      case "agent_message": {
        const text = (msg.message as string) ?? "";
        if (text.trim()) this.agent.say(text.trim());
        break;
      }
      case "turn_complete": {
        session.session.turnActive = false;
        session.session.lastUsed = Date.now();
        this.activeTask = null; // finished cleanly — nothing to resume
        this.deathResumes = 0;
        break;
      }
      case "error": {
        console.error(`[${this.agent.username}] codex error:`, msg);
        session.session.turnActive = false;
        this.activeTask = null;
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
