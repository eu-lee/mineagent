import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, platform, pyramidPlacements } from "../lib/builder.js";

type Block = string;

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 5);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z + 2);

  ctx.log(`building an obelisk at (${cx}, ${baseY}, ${cz})`);

  const placements: { pos: Vec3; block: Block }[] = [];

  // Small, support-friendly footprint.
  placements.push(...platform(new Vec3(cx - 1, baseY, cz - 1), 3, 3, "cobblestone"));
  placements.push({ pos: new Vec3(cx, baseY + 1, cz), block: "oak_wood" });

  // Four bracing arms that make the shape look intentional from a distance.
  const arms = [
    [cx - 1, cz],
    [cx + 1, cz],
    [cx, cz - 1],
    [cx, cz + 1],
  ] as const;
  for (const [x, z] of arms) {
    placements.push({ pos: new Vec3(x, baseY + 1, z), block: "cobbled_deepslate" });
    placements.push({ pos: new Vec3(x, baseY + 2, z), block: "oak_log" });
  }

  // Glass lantern band and crown.
  placements.push(...platform(new Vec3(cx - 1, baseY + 3, cz - 1), 3, 3, "glass"));
  placements.push({ pos: new Vec3(cx, baseY + 4, cz), block: "oak_log" });
  placements.push(...pyramidPlacements(cx, baseY + 5, cz, 3, "cobbled_deepslate"));
  placements.push({ pos: new Vec3(cx, baseY + 7, cz), block: "glass" });

  // Stand off a few blocks so the bot is not building on top of itself.
  await ctx.nav.goto(new Vec3(cx - 4, baseY, cz - 4), 2, ctx.signal);

  const summary = await buildStructure(ctx, placements);
  return `obelisk done: ${summary}`;
}
