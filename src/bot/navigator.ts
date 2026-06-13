import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

const { Movements, goals: Goals } = pathfinderPkg;

/** Max straight-line distance per pathfinding leg. mineflayer-pathfinder degrades
 *  badly on long goals, so journeys are chunked into waypoint legs. */
const LEG_LENGTH = 96;
/** Watchdog: if the bot moves less than this many blocks... */
const STUCK_EPSILON = 0.5;
/** ...over this window while pathing, consider it stuck and re-path. */
const STUCK_WINDOW_MS = 8_000;
/** Re-path attempts per leg before giving up. */
const MAX_RETRIES_PER_LEG = 3;

export class NavigationError extends Error {}
export class NavigationAborted extends NavigationError {
  constructor() {
    super("navigation aborted");
  }
}

export interface GotoResult {
  reached: Vec3;
  distanceToGoal: number;
  elapsedMs: number;
}

/**
 * Abstraction over the pathfinding backend (currently mineflayer-pathfinder).
 * Adds the robustness layer the raw pathfinder lacks: waypoint chunking for
 * long journeys, a stuck watchdog, retries, and cooperative cancellation.
 */
export class Navigator {
  private bot: Bot;
  /** Movement profile that may tunnel/bridge (for goto/collect/build). */
  private digMovements: InstanceType<typeof Movements>;
  /** Movement profile that never digs — for chasing surface mobs so the bot
   *  walks around to a pig instead of mining straight down toward it. */
  private surfaceMovements: InstanceType<typeof Movements>;

  constructor(bot: Bot) {
    this.bot = bot;

    this.digMovements = new Movements(bot);
    this.digMovements.canDig = true;
    this.digMovements.allowSprinting = true;

    this.surfaceMovements = new Movements(bot);
    this.surfaceMovements.canDig = false;
    this.surfaceMovements.allowSprinting = true;

    bot.pathfinder.setMovements(this.digMovements);
  }

  /** Walk to within `range` blocks of (x, y, z). Chunks long journeys. */
  async goto(target: Vec3, range = 1, signal?: AbortSignal): Promise<GotoResult> {
    const start = Date.now();
    let pos = this.bot.entity.position;

    // Chunk into legs no longer than LEG_LENGTH (straight-line interpolation;
    // intermediate legs use GoalNearXZ-style tolerance via a wide GoalNear).
    while (pos.distanceTo(target) > LEG_LENGTH) {
      const dir = target.minus(pos);
      const legTarget = pos.plus(dir.scaled(LEG_LENGTH / dir.norm())).floored();
      await this.gotoLeg(new Goals.GoalNear(legTarget.x, legTarget.y, legTarget.z, 8), signal);
      pos = this.bot.entity.position;
    }

    await this.gotoLeg(new Goals.GoalNear(target.x, target.y, target.z, range), signal);
    pos = this.bot.entity.position;
    return {
      reached: pos.clone(),
      distanceToGoal: pos.distanceTo(target),
      elapsedMs: Date.now() - start,
    };
  }

  /** Follow an entity until aborted. Resolves only on abort. */
  async follow(entityId: number, range = 3, signal?: AbortSignal): Promise<void> {
    const entity = this.bot.entities[entityId];
    if (!entity) throw new NavigationError(`no entity with id ${entityId}`);
    this.bot.pathfinder.setGoal(new Goals.GoalFollow(entity, range), true);
    try {
      await new Promise<void>((resolve, reject) => {
        if (!signal) return; // follow forever until stop() — caller must pass a signal
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
        this.bot.once("end", () => reject(new NavigationError("bot disconnected")));
      });
    } finally {
      this.bot.pathfinder.setGoal(null);
    }
  }

  /**
   * Walk up to a (possibly moving) entity until within `range` blocks. Uses a
   * non-digging movement profile so the bot never tunnels toward a mob, and a
   * follow-goal that re-paths as the target wanders. Resolves once close,
   * rejects on abort, timeout, the entity vanishing, or being stuck.
   */
  async gotoEntity(entity: Entity, range = 2, signal?: AbortSignal, timeoutMs = 30_000): Promise<GotoResult> {
    const start = Date.now();
    const bot = this.bot;
    bot.pathfinder.setMovements(this.surfaceMovements);
    bot.pathfinder.setGoal(new Goals.GoalFollow(entity, range), true);

    let poll: ReturnType<typeof setInterval> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let lastPos = bot.entity.position.clone();
        let lastMove = Date.now();

        poll = setInterval(() => {
          if (!entity.isValid) return reject(new NavigationError("target is gone (died or out of range)"));
          if (Date.now() - start > timeoutMs) return reject(new NavigationError("couldn't reach target in time"));
          if (bot.entity.position.distanceTo(entity.position) <= range + 0.5) return resolve();

          const p = bot.entity.position;
          if (p.distanceTo(lastPos) > STUCK_EPSILON) {
            lastPos = p.clone();
            lastMove = Date.now();
          } else if (Date.now() - lastMove > STUCK_WINDOW_MS) {
            reject(new NavigationError("stuck trying to reach target"));
          }
        }, 250);

        if (signal) {
          onAbort = () => reject(new NavigationAborted());
          if (signal.aborted) return onAbort();
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    } finally {
      if (poll) clearInterval(poll);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      bot.pathfinder.setGoal(null);
      bot.pathfinder.setMovements(this.digMovements); // restore default
    }

    const pos = bot.entity.position;
    return { reached: pos.clone(), distanceToGoal: pos.distanceTo(entity.position), elapsedMs: Date.now() - start };
  }

  stop(): void {
    this.bot.pathfinder.setGoal(null);
  }

  /** One pathfinder leg with stuck watchdog + retries. */
  private async gotoLeg(goal: InstanceType<typeof Goals.GoalNear>, signal?: AbortSignal): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_LEG; attempt++) {
      if (signal?.aborted) throw new NavigationAborted();
      try {
        await this.runWithWatchdog(goal, signal);
        return;
      } catch (err) {
        if (err instanceof NavigationAborted) throw err;
        lastErr = err;
        // Nudge: jump in place before re-pathing, often unsticks ledge/fence cases.
        this.bot.setControlState("jump", true);
        await sleep(350);
        this.bot.setControlState("jump", false);
      }
    }
    throw new NavigationError(
      `failed to reach (${goal.x}, ${goal.y}, ${goal.z}) after ${MAX_RETRIES_PER_LEG + 1} attempts: ${errMsg(lastErr)}`,
    );
  }

  private async runWithWatchdog(goal: InstanceType<typeof Goals.GoalNear>, signal?: AbortSignal): Promise<void> {
    const bot = this.bot;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let onAbort: (() => void) | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        let lastPos = bot.entity.position.clone();
        let lastMove = Date.now();

        watchdog = setInterval(() => {
          const p = bot.entity.position;
          if (p.distanceTo(lastPos) > STUCK_EPSILON) {
            lastPos = p.clone();
            lastMove = Date.now();
          } else if (Date.now() - lastMove > STUCK_WINDOW_MS) {
            bot.pathfinder.setGoal(null);
            reject(new NavigationError("stuck: no movement for " + STUCK_WINDOW_MS + "ms"));
          }
        }, 1_000);

        if (signal) {
          onAbort = () => {
            bot.pathfinder.setGoal(null);
            reject(new NavigationAborted());
          };
          if (signal.aborted) return onAbort();
          signal.addEventListener("abort", onAbort, { once: true });
        }

        bot.pathfinder.goto(goal).then(resolve, reject);
      });
    } finally {
      if (watchdog) clearInterval(watchdog);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
