import type { Bot } from "mineflayer";
import type { Actions } from "./actions.js";
import type { ActionGate } from "./action-gate.js";

/**
 * Keeps an agent fed so its health can regenerate. Periodically, when the bot
 * is idle (not mid-action) and hunger is low, it eats the best food it has.
 * Runs through the gate so it never collides with a player-driven action.
 */
export class AutoEater {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private bot: Bot,
    private actions: Actions,
    private gate: ActionGate,
    private threshold = 16, // eat when food <= this (out of 20)
    private intervalMs = 4_000,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.gate.busyWith) return; // don't interrupt a real action
    if (!this.bot.entity) return; // not spawned / between respawns
    if ((this.bot.food ?? 20) > this.threshold) return;

    try {
      await this.gate.run("auto-eat", async () => {
        const result = await this.actions.eat();
        console.log(`[${this.bot.username}] auto-eat: ${result}`);
        return result;
      });
    } catch {
      // no edible food, or can't eat right now — try again next tick
    }
  }
}
