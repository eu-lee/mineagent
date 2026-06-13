/**
 * Build a compact observatory a short distance from the bot.
 * args: { x?, y?, z? } for the base center; defaults to a spot a bit east/south
 * of the current position.
 */
import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform, pyramidPlacements } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 4);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z + 4);

  ctx.log(`building an observatory at (${cx}, ${baseY}, ${cz})`);

  // Stand outside the footprint before starting so placements have room.
  await ctx.nav.goto(new Vec3(cx + 4, baseY, cz), 1, ctx.signal);

  const tower = hollowBox(
    new Vec3(cx - 1, baseY + 1, cz - 1),
    new Vec3(cx + 2, baseY + 4, cz + 2),
    "cobbled_deepslate",
    { floor: false, ceiling: false },
  ).filter(({ pos }) => !(pos.x === cx && pos.z === cz - 1 && pos.y <= baseY + 2));

  const windows = [
    new Vec3(cx + 0, baseY + 2, cz + 2),
    new Vec3(cx + 0, baseY + 3, cz + 2),
    new Vec3(cx - 1, baseY + 2, cz + 0),
    new Vec3(cx - 1, baseY + 3, cz + 0),
    new Vec3(cx + 2, baseY + 2, cz + 0),
    new Vec3(cx + 2, baseY + 3, cz + 0),
  ].map((pos) => ({ pos, block: "glass" }));

  const roof = pyramidPlacements(cx, baseY + 5, cz, 4, "oak_wood");

  const placements = [...platform(new Vec3(cx - 1, baseY, cz - 1), 4, 4, "cobbled_deepslate"), ...tower, ...windows, ...roof];

  const summary = await buildStructure(ctx, placements);
  return `observatory done: ${summary}`;
}
