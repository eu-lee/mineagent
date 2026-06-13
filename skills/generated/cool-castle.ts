import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 2);
  const baseY = Number(ctx.args.y ?? p.y - 1);
  const cz = Number(ctx.args.z ?? p.z + 2);

  ctx.log(`building a castle at (${cx}, ${baseY}, ${cz})`);

  // Step away from the footprint so the build has room and doesn't clip nearby players.
  await ctx.nav.goto(new Vec3(cx - 4, baseY, cz - 4), 2, ctx.signal);

  const placements = [
    // Courtyard foundation.
    ...platform(new Vec3(cx - 1, baseY, cz - 1), 3, 3, "cobblestone"),

    // Main keep: small shell with a front gate.
    ...hollowBox(
      new Vec3(cx - 1, baseY + 1, cz - 1),
      new Vec3(cx + 1, baseY + 3, cz + 1),
      "cobblestone",
      { floor: false, ceiling: false },
    ),

    // Gatehouse opening and door.
    { pos: new Vec3(cx, baseY + 1, cz - 1), block: "oak_door" },
    { pos: new Vec3(cx, baseY + 2, cz - 1), block: "oak_door" },

    // Windows for the walls.
    { pos: new Vec3(cx - 1, baseY + 2, cz + 1), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz + 1), block: "glass" },

    // Corner turrets.
    { pos: new Vec3(cx - 1, baseY + 4, cz - 1), block: "oak_wood" },
    { pos: new Vec3(cx + 1, baseY + 4, cz - 1), block: "oak_wood" },
    { pos: new Vec3(cx - 1, baseY + 4, cz + 1), block: "oak_wood" },
    { pos: new Vec3(cx + 1, baseY + 4, cz + 1), block: "oak_wood" },

    // Central banner spire.
    { pos: new Vec3(cx, baseY + 1, cz), block: "oak_wood" },
    { pos: new Vec3(cx, baseY + 2, cz), block: "oak_wood" },
    { pos: new Vec3(cx, baseY + 3, cz), block: "oak_wood" },
    { pos: new Vec3(cx, baseY + 4, cz), block: "oak_wood" },
    { pos: new Vec3(cx, baseY + 5, cz), block: "oak_wood" },

  ];

  const summary = await buildStructure(ctx, placements);
  return `castle done: ${summary}`;
}
