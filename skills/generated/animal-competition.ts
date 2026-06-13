import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, platform } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 160);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z + 160);

  ctx.log(`building a fox at (${cx}, ${baseY}, ${cz})`);

  // Stand off to the side so we do not interfere with placement.
  await ctx.nav.goto(new Vec3(cx - 8, baseY, cz - 8), 2, ctx.signal);

  const placements = [
    // Grass stage.
    ...platform(new Vec3(cx - 6, baseY, cz - 4), 13, 9, "green_wool"),

    // Paws.
    { pos: new Vec3(cx - 2, baseY + 1, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx - 2, baseY + 1, cz + 1), block: "black_wool" },
    { pos: new Vec3(cx + 1, baseY + 1, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx + 1, baseY + 1, cz + 1), block: "black_wool" },

    // Body.
    ...platform(new Vec3(cx - 2, baseY + 2, cz - 1), 5, 3, "orange_wool"),
    ...platform(new Vec3(cx - 1, baseY + 3, cz - 1), 4, 3, "orange_wool"),
    ...platform(new Vec3(cx - 1, baseY + 4, cz), 2, 1, "white_wool"),

    // Chest and muzzle.
    { pos: new Vec3(cx + 2, baseY + 2, cz - 1), block: "white_wool" },
    { pos: new Vec3(cx + 2, baseY + 2, cz), block: "white_wool" },
    { pos: new Vec3(cx + 2, baseY + 2, cz + 1), block: "white_wool" },
    { pos: new Vec3(cx + 3, baseY + 2, cz), block: "white_wool" },
    { pos: new Vec3(cx + 4, baseY + 2, cz), block: "white_wool" },
    { pos: new Vec3(cx + 5, baseY + 2, cz), block: "white_wool" },
    { pos: new Vec3(cx + 3, baseY + 3, cz - 1), block: "white_wool" },
    { pos: new Vec3(cx + 3, baseY + 3, cz), block: "white_wool" },
    { pos: new Vec3(cx + 3, baseY + 3, cz + 1), block: "white_wool" },
    { pos: new Vec3(cx + 4, baseY + 3, cz), block: "orange_wool" },

    // Head.
    ...platform(new Vec3(cx + 1, baseY + 4, cz - 1), 4, 3, "orange_wool"),
    { pos: new Vec3(cx + 2, baseY + 5, cz - 1), block: "orange_wool" },
    { pos: new Vec3(cx + 2, baseY + 5, cz + 1), block: "orange_wool" },
    { pos: new Vec3(cx + 3, baseY + 5, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx + 3, baseY + 5, cz + 1), block: "black_wool" },
    { pos: new Vec3(cx + 4, baseY + 5, cz - 1), block: "orange_wool" },
    { pos: new Vec3(cx + 4, baseY + 5, cz + 1), block: "orange_wool" },
    { pos: new Vec3(cx + 3, baseY + 4, cz), block: "white_wool" },
    { pos: new Vec3(cx + 4, baseY + 4, cz), block: "black_wool" },
    { pos: new Vec3(cx + 5, baseY + 4, cz), block: "white_wool" },

    // Ears.
    { pos: new Vec3(cx + 2, baseY + 6, cz - 1), block: "orange_wool" },
    { pos: new Vec3(cx + 2, baseY + 6, cz + 1), block: "orange_wool" },
    { pos: new Vec3(cx + 2, baseY + 7, cz - 1), block: "black_wool" },
    { pos: new Vec3(cx + 2, baseY + 7, cz + 1), block: "black_wool" },

    // Tail, curled to the left.
    { pos: new Vec3(cx - 3, baseY + 2, cz), block: "orange_wool" },
    { pos: new Vec3(cx - 4, baseY + 2, cz), block: "orange_wool" },
    { pos: new Vec3(cx - 5, baseY + 3, cz), block: "orange_wool" },
    { pos: new Vec3(cx - 6, baseY + 3, cz), block: "orange_wool" },
    { pos: new Vec3(cx - 6, baseY + 4, cz), block: "white_wool" },
    { pos: new Vec3(cx - 5, baseY + 4, cz), block: "white_wool" },
  ];

  const summary = await buildStructure(ctx, placements);
  return `fox done: ${summary}`;
}
