import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 14);
  const baseY = Number(ctx.args.y ?? p.y - 1);
  const cz = Number(ctx.args.z ?? p.z + 10);

  ctx.log(`building a compact castle at (${cx}, ${baseY}, ${cz})`);

  // Step away so the bot does not obstruct its own placements.
  await ctx.nav.goto(new Vec3(cx - 8, baseY, cz - 8), 2, ctx.signal);

  const placements = [
    // Foundation and main keep shell.
    ...platform(new Vec3(cx - 1, baseY, cz - 1), 3, 3, "oak_wood"),
    ...hollowBox(
      new Vec3(cx - 1, baseY + 1, cz - 1),
      new Vec3(cx + 1, baseY + 2, cz + 1),
      "oak_wood",
      { floor: false, ceiling: false },
    ),

    // Corner towers: slim, vertical, and cheap on blocks.
    { pos: new Vec3(cx - 1, baseY + 1, cz - 1), block: "oak_log" },
    { pos: new Vec3(cx - 1, baseY + 2, cz - 1), block: "oak_log" },
    { pos: new Vec3(cx - 1, baseY + 3, cz - 1), block: "oak_log" },
    { pos: new Vec3(cx - 1, baseY + 4, cz - 1), block: "oak_log" },

    { pos: new Vec3(cx + 1, baseY + 1, cz - 1), block: "oak_log" },
    { pos: new Vec3(cx + 1, baseY + 2, cz - 1), block: "oak_log" },
    { pos: new Vec3(cx + 1, baseY + 3, cz - 1), block: "oak_log" },
    { pos: new Vec3(cx + 1, baseY + 4, cz - 1), block: "oak_log" },

    { pos: new Vec3(cx - 1, baseY + 1, cz + 1), block: "oak_log" },
    { pos: new Vec3(cx - 1, baseY + 2, cz + 1), block: "oak_log" },
    { pos: new Vec3(cx - 1, baseY + 3, cz + 1), block: "oak_log" },
    { pos: new Vec3(cx - 1, baseY + 4, cz + 1), block: "oak_log" },

    { pos: new Vec3(cx + 1, baseY + 1, cz + 1), block: "oak_log" },
    { pos: new Vec3(cx + 1, baseY + 2, cz + 1), block: "oak_log" },
    { pos: new Vec3(cx + 1, baseY + 3, cz + 1), block: "oak_log" },
    { pos: new Vec3(cx + 1, baseY + 4, cz + 1), block: "oak_log" },

    // Front gate and windows.
    { pos: new Vec3(cx, baseY + 1, cz - 1), block: "oak_door" },
    { pos: new Vec3(cx, baseY + 2, cz - 1), block: "oak_door" },
    { pos: new Vec3(cx - 1, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx - 1, baseY + 2, cz), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz), block: "glass" },
    { pos: new Vec3(cx, baseY + 2, cz + 1), block: "glass" },

    // Roof over the keep and battlements above it.
    ...platform(new Vec3(cx - 1, baseY + 3, cz - 1), 3, 3, "oak_wood"),
    ...hollowBox(
      new Vec3(cx - 2, baseY + 4, cz - 2),
      new Vec3(cx + 2, baseY + 4, cz + 2),
      "cobbled_deepslate",
      { floor: false, ceiling: false },
    ),
  ];

  const summary = await buildStructure(ctx, placements);
  return `castle done: ${summary}`;
}
