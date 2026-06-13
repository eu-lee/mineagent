/**
 * Example/reference skill: build a solid pyramid near the bot.
 * args: { size?: number (odd, default 7), block?: string (default "stone"),
 *         x?, y?, z? (base center; defaults to ~6 blocks in front of the bot) }
 */
import { Vec3 } from "vec3";
import type { SkillContext } from "../src/skills/runtime.js";
import { buildStructure, pyramidPlacements } from "./lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const size = Math.max(3, Number(ctx.args.size ?? 7)) | 1; // force odd
  const block = String(ctx.args.block ?? "stone");

  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + size + 2);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z);

  ctx.log(`building a ${size}x${size} ${block} pyramid at (${cx}, ${baseY}, ${cz})`);
  const placements = pyramidPlacements(cx, baseY, cz, size, block);

  // Stand outside the footprint before starting.
  await ctx.nav.goto(new Vec3(cx - Math.ceil(size / 2) - 2, baseY, cz), 1, ctx.signal);

  const summary = await buildStructure(ctx, placements); // materials via ctx.creativeGive
  return `pyramid done: ${summary}`;
}
