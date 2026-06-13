import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform, pyramidPlacements } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const start = ctx.bot.entity.position.floored();
  const { dx, dz, distance } = chooseOffset(ctx.bot.username);

  const seedX = start.x + dx * distance;
  const seedZ = start.z + dz * distance;

  ctx.log(`spreading out toward (${seedX}, ${seedZ})`);
  await flyToStagingSpot(ctx, new Vec3(seedX, start.y, seedZ));

  const p = ctx.bot.entity.position.floored();
  const cx = p.x;
  const cz = p.z;
  const baseY = p.y;
  const width = 9;
  const depth = 7;
  const minX = cx - Math.floor(width / 2);
  const minZ = cz - Math.floor(depth / 2);
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  const midX = cx;
  const midZ = cz;
  const floorY = baseY + 1;
  const wallStartY = baseY + 2;
  const wallTopY = baseY + 4;
  const roofBaseY = wallTopY + 1;

  ctx.log(`building a medium house at (${minX}, ${baseY}, ${minZ})`);

  const placements = [
    // Foundation and floor.
    ...platform(new Vec3(minX, baseY, minZ), width, depth, "stone_bricks"),
    ...platform(new Vec3(minX, floorY, minZ), width, depth, "oak_planks"),

    // Main shell.
    ...hollowBox(
      new Vec3(minX, wallStartY, minZ),
      new Vec3(maxX, wallTopY, maxZ),
      "stone_bricks",
      { floor: false, ceiling: false },
    ),

    // Corner trim.
    { pos: new Vec3(minX, wallStartY, minZ), block: "black_wool" },
    { pos: new Vec3(maxX, wallStartY, minZ), block: "black_wool" },
    { pos: new Vec3(minX, wallStartY, maxZ), block: "black_wool" },
    { pos: new Vec3(maxX, wallStartY, maxZ), block: "black_wool" },

    // Front entrance and windows.
    { pos: new Vec3(midX, wallStartY, minZ), block: "oak_door" },
    { pos: new Vec3(midX, wallStartY + 1, minZ), block: "oak_door" },
    { pos: new Vec3(minX + 2, wallStartY + 1, minZ), block: "white_wool" },
    { pos: new Vec3(minX + 3, wallStartY + 1, minZ), block: "white_wool" },
    { pos: new Vec3(maxX - 3, wallStartY + 1, minZ), block: "white_wool" },
    { pos: new Vec3(maxX - 2, wallStartY + 1, minZ), block: "white_wool" },

    // Side windows.
    { pos: new Vec3(minX, wallStartY + 1, minZ + 1), block: "white_wool" },
    { pos: new Vec3(maxX, wallStartY + 1, maxZ - 1), block: "white_wool" },

    // Rear window band.
    { pos: new Vec3(midX - 1, wallStartY + 1, maxZ), block: "white_wool" },
    { pos: new Vec3(midX, wallStartY + 1, maxZ), block: "white_wool" },
    { pos: new Vec3(midX + 1, wallStartY + 1, maxZ), block: "white_wool" },

    // Roof.
    ...pyramidPlacements(midX, roofBaseY, midZ, 9, "orange_wool"),
  ];

  await clearConflicts(ctx, placements);
  const summary = await buildStructure(ctx, placements, { creativeGive: true });
  return `medium house built: ${summary}`;
}

function chooseOffset(username: string): { dx: number; dz: number; distance: number } {
  const dirs = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
    { dx: 1, dz: 1 },
    { dx: -1, dz: 1 },
    { dx: 1, dz: -1 },
    { dx: -1, dz: -1 },
  ];
  let hash = 0;
  for (const ch of username) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const dir = dirs[hash % dirs.length];
  const distance = 24 + (hash % 4) * 4;
  return { ...dir, distance };
}

function isClear(block: any): boolean {
  if (!block) return true;
  return (
    block.name === "air" ||
    block.name === "cave_air" ||
    block.name === "void_air" ||
    block.name === "water" ||
    block.name.includes("grass")
  );
}

async function clearConflicts(ctx: SkillContext, placements: { pos: Vec3; block: string }[]): Promise<void> {
  const seen = new Set<string>();
  for (const placement of placements) {
    if (ctx.signal.aborted) throw new Error("build aborted");
    const key = `${placement.pos.x},${placement.pos.y},${placement.pos.z}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = ctx.bot.blockAt(placement.pos);
    if (!existing || isClear(existing) || existing.name === placement.block) continue;
    await ctx.actions.digBlockAt(placement.pos.x, placement.pos.y, placement.pos.z, ctx.signal).catch(() => {});
  }
}

async function flyToStagingSpot(ctx: SkillContext, destination: Vec3): Promise<void> {
  const bot = ctx.bot as typeof ctx.bot & {
    creative?: { startFlying: () => void; stopFlying: () => void; flyTo: (destination: Vec3) => Promise<void> };
  };
  if (!bot.creative) return;

  bot.creative.startFlying();
  try {
    await bot.creative.flyTo(destination);
  } finally {
    bot.creative.stopFlying();
  }
}
