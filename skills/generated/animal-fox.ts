import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, line, platform, cuboid } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 12);
  const baseY = Number(ctx.args.y ?? p.y - 1);
  const cz = Number(ctx.args.z ?? p.z + 12);

  ctx.log(`building a fox at (${cx}, ${baseY}, ${cz})`);

  const placements = [
    // Pedestal.
    ...platform(new Vec3(cx - 2, baseY, cz - 2), 5, 5, "stone_bricks"),

    // Body and chest.
    ...cuboid(new Vec3(cx - 1, baseY + 1, cz - 1), new Vec3(cx + 1, baseY + 2, cz + 1), "orange_wool"),
    ...cuboid(new Vec3(cx, baseY + 1, cz - 1), new Vec3(cx + 1, baseY + 2, cz + 1), "white_wool"),

    // Head and snout.
    ...cuboid(new Vec3(cx + 1, baseY + 2, cz - 1), new Vec3(cx + 3, baseY + 4, cz + 1), "orange_wool"),
    ...cuboid(new Vec3(cx + 3, baseY + 2, cz), new Vec3(cx + 4, baseY + 3, cz), "white_wool"),

    // Ears.
    { pos: new Vec3(cx + 1, baseY + 5, cz - 1), block: "orange_wool" },
    { pos: new Vec3(cx + 3, baseY + 5, cz + 1), block: "orange_wool" },
    { pos: new Vec3(cx + 1, baseY + 6, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx + 3, baseY + 6, cz + 1), block: "black_wool" },

    // Eyes and nose.
    { pos: new Vec3(cx + 2, baseY + 3, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx + 2, baseY + 3, cz + 1), block: "black_wool" },
    { pos: new Vec3(cx + 4, baseY + 2, cz), block: "black_wool" },

    // Tail sweeping behind the body.
    ...line(new Vec3(cx - 1, baseY + 2, cz + 1), new Vec3(cx - 4, baseY + 4, cz + 2), "orange_wool"),
    ...cuboid(new Vec3(cx - 5, baseY + 4, cz + 2), new Vec3(cx - 4, baseY + 5, cz + 2), "white_wool"),
  ];

  const summary = await buildStructure(ctx, placements);
  return `fox done: ${summary}`;
}
