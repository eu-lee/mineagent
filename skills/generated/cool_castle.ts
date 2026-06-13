import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform, pyramidPlacements } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z);

  ctx.log(`building a small castle at (${cx}, ${baseY}, ${cz})`);

  const placements = [
    // Base and curtain wall.
    ...platform(new Vec3(cx - 2, baseY, cz - 2), 5, 5, "cobblestone"),
    ...hollowBox(
      new Vec3(cx - 2, baseY + 1, cz - 2),
      new Vec3(cx + 2, baseY + 2, cz + 2),
      "cobblestone",
      { floor: false, ceiling: false },
    ).filter((p) => !(p.pos.z === cz + 2 && p.pos.x === cx && p.pos.y <= baseY + 2)),

    // Gate opening and small windows.
    { pos: new Vec3(cx, baseY + 1, cz + 2), block: "oak_door" },
    { pos: new Vec3(cx, baseY + 2, cz + 2), block: "oak_door" },
    { pos: new Vec3(cx - 1, baseY + 2, cz), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz), block: "glass" },
    { pos: new Vec3(cx, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx, baseY + 2, cz + 1), block: "glass" },

    // Keep roof.
    ...platform(new Vec3(cx - 1, baseY + 3, cz - 1), 3, 3, "oak_wood"),
    ...pyramidPlacements(cx, baseY + 4, cz, 3, "oak_wood", { hollow: true }),
  ];

  const summary = await buildStructure(ctx, placements);
  return `castle done: ${summary}`;
}
