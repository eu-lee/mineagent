import mineflayer, { type Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import type { Config } from "../config.js";

const { pathfinder, Movements } = pathfinderPkg;

export interface ChatCommand {
  username: string;
  message: string;
}

export type ChatHandler = (cmd: ChatCommand) => void;

/**
 * Wraps the mineflayer bot: connection, auto-reconnect, chat listening.
 * Phase 1: connect + echo. Later phases attach actions/navigator on top.
 */
export class AgentBot {
  bot!: Bot;
  readonly username: string;
  private cfg: Config;
  private chatHandlers: ChatHandler[] = [];
  private stopped = false;
  private reconnectDelayMs = 3_000;

  constructor(cfg: Config, username: string) {
    this.cfg = cfg;
    this.username = username;
  }

  async start(): Promise<void> {
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.bot?.quit();
  }

  onChat(handler: ChatHandler): void {
    this.chatHandlers.push(handler);
  }

  /** Send a chat message, split to fit server line-length limits. */
  say(message: string): void {
    const max = this.cfg.chat.maxChatLineLength;
    for (const line of message.split("\n")) {
      for (let i = 0; i < line.length; i += max) {
        this.bot.chat(line.slice(i, i + max));
      }
    }
  }

  private connect(): Promise<void> {
    const mc = this.cfg.minecraft;
    const bot = mineflayer.createBot({
      host: mc.host,
      port: mc.port,
      version: mc.version,
      username: this.username,
      auth: mc.auth === "microsoft" ? "microsoft" : "offline",
    });
    this.bot = bot;

    bot.loadPlugin(pathfinder);

    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      for (const h of this.chatHandlers) h({ username, message });
    });

    bot.on("kicked", (reason) => console.error("[bot] kicked:", reason));
    bot.on("error", (err) => console.error("[bot] error:", err.message));
    bot.on("end", (reason) => {
      console.error("[bot] disconnected:", reason);
      if (!this.stopped) {
        console.error(`[bot] reconnecting in ${this.reconnectDelayMs}ms`);
        setTimeout(() => void this.connect(), this.reconnectDelayMs);
      }
    });

    return new Promise((resolve, reject) => {
      bot.once("spawn", () => {
        console.log(`[bot] spawned as ${bot.username} at ${bot.entity.position}`);
        bot.pathfinder.setMovements(new Movements(bot));
        resolve();
      });
      bot.once("error", reject);
    });
  }
}
