import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Actions } from "./actions.js";
import type { Navigator } from "./navigator.js";
import type { ActionGate } from "./action-gate.js";

/** Hostile mobs the survival reflex reacts to. */
const HOSTILE_NAMES = new Set([
  "zombie", "zombie_villager", "husk", "drowned", "skeleton", "stray", "bogged",
  "creeper", "spider", "cave_spider", "witch", "slime", "magma_cube", "phantom",
  "pillager", "vindicator", "evoker", "ravager", "vex", "zombified_piglin",
  "piglin", "piglin_brute", "hoglin", "zoglin", "blaze", "ghast", "silverfish",
  "endermite", "guardian", "elder_guardian", "shulker", "warden", "breeze",
]);

const DANGER_RADIUS = 12; // notice hostiles within this many blocks
const ENGAGE_RANGE = 10; // fight (rather than ignore) hostiles within this range
const CRITICAL_HEALTH = 8; // at/below this, flee + heal instead of fighting
const REGEN_FOOD = 18; // eat to keep hunger high enough for health regen

/**
 * A per-agent survival reflex. When ON, it runs in the background (independent
 * of the Codex brain) and, when a threat or low health appears, PREEMPTS the
 * agent's current action to defend, flee, and heal — then yields control back.
 * One body can only do one thing at a time, so this interrupts other commands
 * when danger strikes rather than acting truly simultaneously.
 */
export class Survival {
  private timer?: ReturnType<typeof setInterval>;
  private active = false;
  private reacting = false;

  constructor(
    private bot: Bot,
    private actions: Actions,
    private nav: Navigator,
    private gate: ActionGate,
    private tickMs = 1_000,
  ) {}

  get isOn(): boolean {
    return this.active;
  }

  on(): void {
    this.active = true;
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  off(): void {
    this.active = false;
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (!this.active || this.reacting || !this.bot.entity) return;

    const health = this.bot.health ?? 20;
    const food = this.bot.food ?? 20;
    const threat = this.nearestHostile();

    try {
      this.reacting = true;
      if (threat) {
        const dist = this.bot.entity.position.distanceTo(threat.position);
        if (health <= CRITICAL_HEALTH) {
          await this.gate.preempt("survive: flee", (s) => this.flee(threat.position, s));
        } else if (dist <= ENGAGE_RANGE) {
          await this.gate.preempt("survive: defend", (s) => this.actions.attackEntity(threat, s).then(() => {}));
        }
      } else if (!this.gate.busyWith && (food <= REGEN_FOOD || health < 20) && this.hasFood()) {
        // Calm: top up only when idle so we don't interrupt real work.
        await this.gate.run("survive: eat", () => this.actions.eat().then(() => {}));
      }
    } catch {
      // aborted / nothing to eat / can't path — try again next tick
    } finally {
      this.reacting = false;
    }
  }

  /** Run away from a position, then eat if possible. */
  private async flee(from: Vec3, signal?: AbortSignal): Promise<void> {
    const me = this.bot.entity.position;
    const dir = me.minus(from);
    dir.y = 0;
    const n = dir.norm() || 1;
    const away = me.plus(dir.scaled(14 / n));
    await this.nav.goto(away, 2, signal).catch(() => {});
    if (this.hasFood()) await this.actions.eat().catch(() => {});
  }

  private nearestHostile() {
    return this.bot.nearestEntity(
      (e) =>
        HOSTILE_NAMES.has(e.name ?? "") &&
        e.position &&
        e.position.distanceTo(this.bot.entity.position) <= DANGER_RADIUS,
    );
  }

  private hasFood(): boolean {
    const foods = this.bot.registry.foods as Record<number, unknown>;
    return this.bot.inventory.items().some((i) => foods[i.type]);
  }
}
