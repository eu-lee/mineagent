import type { SkillContext } from "../../src/skills/runtime.js";

export async function run(ctx: SkillContext): Promise<string> {
  const bot = ctx.bot;
  const signal = ctx.signal;
  const start = bot.entity.position.clone();
  const startTime = Date.now();
  const yaw = bot.entity.yaw;

  ctx.log("turning right and walking...");
  bot.pathfinder.setGoal(null);
  bot.clearControlStates?.();
  await bot.look(yaw - Math.PI / 2, 0, true).catch(() => {});
  bot.setControlState("forward", true);

  try {
    while (!signal.aborted) {
      const pos = bot.entity.position;
      const moved = Math.sqrt(
        (pos.x - start.x) * (pos.x - start.x) +
        (pos.z - start.z) * (pos.z - start.z),
      );
      if (moved >= 6) break;
      if (Date.now() - startTime > 8000) {
        throw new Error(`couldn't move far enough (moved ${moved.toFixed(1)} blocks)`);
      }
      await sleep(50);
    }
  } finally {
    bot.setControlState("forward", false);
  }

  const end = bot.entity.position.clone();
  const moved = Math.sqrt((end.x - start.x) ** 2 + (end.z - start.z) ** 2);
  return `moved ${moved.toFixed(1)} blocks to the right`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
