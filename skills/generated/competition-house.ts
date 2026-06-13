import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform, pyramidPlacements } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 10);
  const baseY = Number(ctx.args.y ?? p.y - 1);
  const cz = Number(ctx.args.z ?? p.z + 6);

  ctx.log(`building a cottage at (${cx}, ${baseY}, ${cz})`);

  // Move aside before building so we don't collide with the structure or the players.
  await ctx.nav.goto(new Vec3(cx - 7, baseY, cz - 7), 2, ctx.signal);

  const placements = [
    // Foundation and porch.
    ...platform(new Vec3(cx - 3, baseY, cz - 3), 7, 7, "cobblestone"),
    ...platform(new Vec3(cx - 1, baseY, cz - 4), 3, 1, "oak_wood"),

    // Main body.
    ...hollowBox(
      new Vec3(cx - 2, baseY + 1, cz - 2),
      new Vec3(cx + 2, baseY + 3, cz + 2),
      "cobblestone",
      { floor: false, ceiling: false },
    ),

    // Corner logs and trim.
    { pos: new Vec3(cx - 2, baseY + 1, cz - 2), block: "cobbled_deepslate" },
    { pos: new Vec3(cx + 2, baseY + 1, cz - 2), block: "cobbled_deepslate" },
    { pos: new Vec3(cx - 2, baseY + 1, cz + 2), block: "cobbled_deepslate" },
    { pos: new Vec3(cx + 2, baseY + 1, cz + 2), block: "cobbled_deepslate" },

    // Front wall with door and windows.
    { pos: new Vec3(cx, baseY + 1, cz - 2), block: "oak_door" },
    { pos: new Vec3(cx, baseY + 2, cz - 2), block: "oak_door" },
    { pos: new Vec3(cx - 1, baseY + 2, cz - 2), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz - 2), block: "glass" },
    { pos: new Vec3(cx - 2, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx + 2, baseY + 2, cz - 1), block: "glass" },
    { pos: new Vec3(cx - 2, baseY + 2, cz + 1), block: "glass" },
    { pos: new Vec3(cx + 2, baseY + 2, cz + 1), block: "glass" },

    // Side and back windows.
    { pos: new Vec3(cx - 2, baseY + 2, cz), block: "glass" },
    { pos: new Vec3(cx + 2, baseY + 2, cz), block: "glass" },
    { pos: new Vec3(cx, baseY + 2, cz + 2), block: "glass" },
    { pos: new Vec3(cx - 1, baseY + 2, cz + 2), block: "glass" },
    { pos: new Vec3(cx + 1, baseY + 2, cz + 2), block: "glass" },

    // Roof and chimney.
    ...pyramidPlacements(cx, baseY + 4, cz, 3, "oak_wood", { hollow: true }),
    ...platform(new Vec3(cx - 1, baseY + 5, cz - 1), 3, 3, "glass"),
    { pos: new Vec3(cx + 2, baseY + 4, cz + 1), block: "cobbled_deepslate" },
    { pos: new Vec3(cx + 2, baseY + 5, cz + 1), block: "cobbled_deepslate" },
    { pos: new Vec3(cx + 2, baseY + 6, cz + 1), block: "cobbled_deepslate" },
    { pos: new Vec3(cx + 1, baseY + 6, cz + 1), block: "cobbled_deepslate" },
    { pos: new Vec3(cx + 2, baseY + 6, cz), block: "cobbled_deepslate" },
  ];

  const summary = await buildStructure(ctx, placements);
  return `house done: ${summary}`;
}
