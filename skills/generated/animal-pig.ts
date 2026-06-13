import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, platform } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 80);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z + 80);

  ctx.log(`building a pig at (${cx}, ${baseY}, ${cz})`);

  // Stand outside the footprint so the first placements have room.
  await ctx.nav.goto(new Vec3(cx + 10, baseY, cz + 10), 2, ctx.signal);
  await ctx.actions.pillarUp("stone_bricks", 2, ctx.signal);

  const placements = [
    // Small stage so the statue reads clearly from a distance.
    ...platform(new Vec3(cx - 3, baseY, cz - 3), 7, 7, "stone_bricks"),
    ...platform(new Vec3(cx - 2, baseY + 1, cz - 2), 5, 5, "grass_block"),

    // Body and head.
    ...platform(new Vec3(cx - 1, baseY + 2, cz - 1), 3, 3, "pink_wool"),
    ...platform(new Vec3(cx + 1, baseY + 2, cz - 1), 3, 3, "pink_wool"),
    ...platform(new Vec3(cx + 3, baseY + 3, cz - 1), 2, 3, "pink_wool"),

    // Legs.
    { pos: new Vec3(cx - 1, baseY + 1, cz - 1), block: "pink_wool" },
    { pos: new Vec3(cx - 1, baseY + 1, cz + 1), block: "pink_wool" },
    { pos: new Vec3(cx + 1, baseY + 1, cz - 1), block: "pink_wool" },
    { pos: new Vec3(cx + 1, baseY + 1, cz + 1), block: "pink_wool" },

    // Face.
    { pos: new Vec3(cx + 4, baseY + 4, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx + 4, baseY + 4, cz + 1), block: "black_wool" },
    { pos: new Vec3(cx + 5, baseY + 3, cz), block: "pink_wool" },

    // Ears and tail.
    { pos: new Vec3(cx + 3, baseY + 5, cz - 1), block: "pink_wool" },
    { pos: new Vec3(cx + 3, baseY + 5, cz + 1), block: "pink_wool" },
    { pos: new Vec3(cx - 2, baseY + 3, cz), block: "pink_wool" },
  ];

  const summary = await buildStructure(ctx, placements);
  return `pig done: ${summary}`;
}
