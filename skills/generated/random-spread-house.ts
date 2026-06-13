import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform, pyramidPlacements } from "../lib/builder.js";

type Site = { minX: number; minZ: number; baseY: number };

const DIRECTIONS = [
  { name: "east", dx: 1, dz: 0 },
  { name: "west", dx: -1, dz: 0 },
  { name: "south", dx: 0, dz: 1 },
  { name: "north", dx: 0, dz: -1 },
  { name: "northeast", dx: 1, dz: -1 },
  { name: "northwest", dx: -1, dz: -1 },
  { name: "southeast", dx: 1, dz: 1 },
  { name: "southwest", dx: -1, dz: 1 },
];

export async function run(ctx: SkillContext): Promise<string> {
  const start = ctx.bot.entity.position.floored();
  const dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
  const distance = 24 + Math.floor(Math.random() * 8);
  const seedX = start.x + dir.dx * distance;
  const seedZ = start.z + dir.dz * distance;
  const width = 13;
  const depth = 11;

  ctx.log(`flying ${dir.name} to spread out first`);
  await flyTo(ctx, new Vec3(seedX, start.y + 16, seedZ));

  const site =
    findSite(ctx, seedX, seedZ, width, depth, start.y - 20, start.y + 20) ??
    findSite(ctx, start.x, start.z, width, depth, start.y - 20, start.y + 20);
  if (!site) {
    throw new Error("couldn't find a clear flat spot for the house");
  }

  const { minX, minZ, baseY } = site;
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  const midX = Math.floor((minX + maxX) / 2);
  const midZ = Math.floor((minZ + maxZ) / 2);
  const floorY = baseY + 1;
  const wallStartY = baseY + 2;
  const wallTopY = baseY + 5;
  const roofBaseY = wallTopY + 1;

  ctx.log(`building a medium house at (${minX}, ${baseY}, ${minZ})`);

  await ctx.nav.goto(new Vec3(minX - 4, baseY, midZ), 2, ctx.signal);

  const placements = [
    // Foundation and floor.
    ...platform(new Vec3(minX, baseY, minZ), width, depth, "stone_bricks"),
    ...platform(new Vec3(minX, floorY, minZ), width, depth, "stone_bricks"),

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
    { pos: new Vec3(midX - 1, wallStartY, minZ), block: "pink_wool" },
    { pos: new Vec3(midX + 1, wallStartY, minZ), block: "pink_wool" },
    { pos: new Vec3(minX + 2, wallStartY + 1, minZ), block: "pink_wool" },
    { pos: new Vec3(minX + 3, wallStartY + 1, minZ), block: "pink_wool" },
    { pos: new Vec3(maxX - 3, wallStartY + 1, minZ), block: "pink_wool" },
    { pos: new Vec3(maxX - 2, wallStartY + 1, minZ), block: "pink_wool" },

    // Side windows.
    { pos: new Vec3(minX, wallStartY + 1, minZ + 2), block: "pink_wool" },
    { pos: new Vec3(minX, wallStartY + 1, maxZ - 2), block: "pink_wool" },
    { pos: new Vec3(maxX, wallStartY + 1, minZ + 2), block: "pink_wool" },
    { pos: new Vec3(maxX, wallStartY + 1, maxZ - 2), block: "pink_wool" },

    // Rear window band.
    { pos: new Vec3(midX - 1, wallStartY + 1, maxZ), block: "pink_wool" },
    { pos: new Vec3(midX, wallStartY + 1, maxZ), block: "pink_wool" },
    { pos: new Vec3(midX + 1, wallStartY + 1, maxZ), block: "pink_wool" },

    // Front porch.
    ...platform(new Vec3(midX - 2, baseY + 1, minZ - 3), 5, 3, "stone_bricks"),
    { pos: new Vec3(midX - 2, baseY + 2, minZ - 3), block: "black_wool" },
    { pos: new Vec3(midX + 2, baseY + 2, minZ - 3), block: "black_wool" },
    { pos: new Vec3(midX - 2, baseY + 3, minZ - 3), block: "black_wool" },
    { pos: new Vec3(midX + 2, baseY + 3, minZ - 3), block: "black_wool" },

    // Roof.
    ...pyramidPlacements(midX, roofBaseY, midZ, 13, "black_wool"),

    // Chimney.
    { pos: new Vec3(minX + 2, roofBaseY + 1, minZ + 2), block: "stone_bricks" },
    { pos: new Vec3(minX + 2, roofBaseY + 2, minZ + 2), block: "stone_bricks" },
    { pos: new Vec3(minX + 2, roofBaseY + 3, minZ + 2), block: "stone_bricks" },
  ];

  await clearConflicts(ctx, placements);
  const summary = await buildStructure(ctx, placements, { creativeGive: true });
  return `medium house built after flying ${dir.name}: ${summary}`;
}

async function flyTo(ctx: SkillContext, destination: Vec3): Promise<void> {
  const creative = (ctx.bot as any).creative;
  if (creative?.flyTo) {
    await creative.flyTo(destination);
    if (creative.stopFlying) creative.stopFlying();
    return;
  }
  await ctx.nav.goto(destination, 2, ctx.signal);
}

function findSite(
  ctx: SkillContext,
  seedX: number,
  seedZ: number,
  width: number,
  depth: number,
  minY: number,
  maxY: number,
): Site | null {
  const bot = ctx.bot;
  const radiusLimit = 48;
  const step = 2;
  const halfW = Math.floor(width / 2);
  const halfD = Math.floor(depth / 2);

  for (let r = 0; r <= radiusLimit; r += step) {
    for (const [dx, dz] of ringOffsets(r, step)) {
      const minX = seedX + dx - halfW;
      const minZ = seedZ + dz - halfD;
      const sampleXs = [minX, minX + Math.floor(width / 2), minX + width - 1];
      const sampleZs = [minZ, minZ + Math.floor(depth / 2), minZ + depth - 1];

      const heights: number[] = [];
      let ok = true;
      for (const x of sampleXs) {
        for (const z of sampleZs) {
          const ground = findGroundY(bot, x, z, minY, maxY);
          if (ground == null) {
            ok = false;
            break;
          }
          heights.push(ground);
        }
        if (!ok) break;
      }
      if (!ok) continue;

      const minGround = Math.min(...heights);
      const maxGround = Math.max(...heights);
      if (maxGround - minGround > 1) continue;

      const baseY = maxGround;
      if (!footprintClear(bot, minX, minZ, width, depth, baseY + 1, baseY + 14)) continue;

      return { minX, minZ, baseY };
    }
  }

  return null;
}

function findGroundY(bot: any, x: number, z: number, minY: number, maxY: number): number | null {
  for (let y = Math.min(maxY, bot.entity.position.floored().y + 16); y >= minY; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    const above = bot.blockAt(new Vec3(x, y + 1, z));
    if (!block || block.boundingBox !== "block") continue;
    if (!isClear(above)) continue;
    return y;
  }
  return null;
}

function footprintClear(
  bot: any,
  minX: number,
  minZ: number,
  width: number,
  depth: number,
  minY: number,
  maxY: number,
): boolean {
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x < minX + width; x++) {
      for (let z = minZ; z < minZ + depth; z++) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!isClear(block)) return false;
      }
    }
  }
  return true;
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

function ringOffsets(radius: number, step: number): Array<[number, number]> {
  if (radius === 0) return [[0, 0]];
  const out: Array<[number, number]> = [];
  for (let dx = -radius; dx <= radius; dx += step) {
    out.push([dx, -radius], [dx, radius]);
  }
  for (let dz = -radius + step; dz <= radius - step; dz += step) {
    out.push([-radius, dz], [radius, dz]);
  }
  return out;
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
