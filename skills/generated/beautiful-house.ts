import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, line, platform, pyramidPlacements } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 2);
  const baseY = Number(ctx.args.y ?? p.y - 1);
  const cz = Number(ctx.args.z ?? p.z + 2);

  ctx.log(`building a beautiful house at (${cx}, ${baseY}, ${cz})`);

  const placements = [
    // Ground footprint and porch.
    ...platform(new Vec3(cx - 6, baseY, cz - 4), 13, 9, "cobblestone"),
    ...platform(new Vec3(cx - 2, baseY + 1, cz - 7), 5, 3, "oak_wood"),

    // Main shell.
    ...hollowBox(
      new Vec3(cx - 5, baseY + 1, cz - 3),
      new Vec3(cx + 5, baseY + 5, cz + 3),
      "oak_planks",
      { floor: false, ceiling: false },
    ),

    // Corner posts and porch supports.
    ...line(new Vec3(cx - 5, baseY + 1, cz - 3), new Vec3(cx - 5, baseY + 5, cz - 3), "oak_log"),
    ...line(new Vec3(cx + 5, baseY + 1, cz - 3), new Vec3(cx + 5, baseY + 5, cz - 3), "oak_log"),
    ...line(new Vec3(cx - 5, baseY + 1, cz + 3), new Vec3(cx - 5, baseY + 5, cz + 3), "oak_log"),
    ...line(new Vec3(cx + 5, baseY + 1, cz + 3), new Vec3(cx + 5, baseY + 5, cz + 3), "oak_log"),
    ...line(new Vec3(cx - 2, baseY + 2, cz - 7), new Vec3(cx - 2, baseY + 4, cz - 7), "oak_log"),
    ...line(new Vec3(cx + 2, baseY + 2, cz - 7), new Vec3(cx + 2, baseY + 4, cz - 7), "oak_log"),

    // Front entry and windows.
    { pos: new Vec3(cx, baseY + 1, cz - 3), block: "oak_door" },
    { pos: new Vec3(cx, baseY + 2, cz - 3), block: "oak_door" },
    { pos: new Vec3(cx - 3, baseY + 2, cz - 3), block: "glass" },
    { pos: new Vec3(cx - 1, baseY + 2, cz - 3), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz - 3), block: "glass" },
    { pos: new Vec3(cx + 3, baseY + 2, cz - 3), block: "glass" },
    { pos: new Vec3(cx - 5, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx - 5, baseY + 3, cz - 1), block: "glass" },
    { pos: new Vec3(cx + 5, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx + 5, baseY + 3, cz - 1), block: "glass" },
    { pos: new Vec3(cx - 5, baseY + 2, cz + 1), block: "glass" },
    { pos: new Vec3(cx - 5, baseY + 3, cz + 1), block: "glass" },
    { pos: new Vec3(cx + 5, baseY + 2, cz + 1), block: "glass" },
    { pos: new Vec3(cx + 5, baseY + 3, cz + 1), block: "glass" },
    { pos: new Vec3(cx - 2, baseY + 2, cz + 3), block: "glass" },
    { pos: new Vec3(cx, baseY + 2, cz + 3), block: "glass" },
    { pos: new Vec3(cx + 2, baseY + 2, cz + 3), block: "glass" },

    // Rear sunroom.
    ...platform(new Vec3(cx - 2, baseY + 1, cz + 4), 5, 3, "oak_wood"),
    ...hollowBox(
      new Vec3(cx - 2, baseY + 2, cz + 4),
      new Vec3(cx + 2, baseY + 4, cz + 6),
      "glass",
      { floor: false, ceiling: false },
    ),

    // Roof and skylight.
    ...pyramidPlacements(cx, baseY + 6, cz, 11, "oak_wood", { hollow: true }),
    ...platform(new Vec3(cx - 1, baseY + 7, cz - 1), 3, 3, "glass"),

    // Chimneys.
    ...line(new Vec3(cx - 4, baseY + 6, cz - 1), new Vec3(cx - 4, baseY + 8, cz - 1), "cobbled_deepslate"),
    ...line(new Vec3(cx + 4, baseY + 6, cz + 1), new Vec3(cx + 4, baseY + 8, cz + 1), "cobbled_deepslate"),
  ];

  const summary = await buildStructure(ctx, placements);
  return `beautiful house done: ${summary}`;
}
