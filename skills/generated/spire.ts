import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const x = Number(ctx.args.x ?? p.x + 14);
  const z = Number(ctx.args.z ?? p.z + 14);
  const baseY = Number(ctx.args.y ?? p.y);

  ctx.log(`moving to (${x}, ${baseY}, ${z}) and building a spire`);
  await ctx.nav.goto(new Vec3(x, baseY, z), 1, ctx.signal);

  const segments = [
    { item: "cobblestone", count: 6 },
    { item: "cobbled_deepslate", count: 4 },
    { item: "oak_wood", count: 4 },
    { item: "glass", count: 4 },
    { item: "oak_wood", count: 2 },
  ];

  let total = 0;
  for (const segment of segments) {
    if (ctx.signal.aborted) throw new Error("build aborted");
    ctx.log(`raising ${segment.count} blocks of ${segment.item}...`);
    await ctx.actions.pillarUp(segment.item, segment.count, ctx.signal);
    total += segment.count;
  }

  return `spire done: raised ${total} blocks`;
}
