import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, platform, pyramidPlacements } from "../lib/builder.js";

type Placement = { pos: Vec3; block: string };
type Site = { minX: number; minZ: number; baseY: number };

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();

  const width = Number(ctx.args.width ?? 25);
  const depth = Number(ctx.args.depth ?? 17);
  const seedX = Number(ctx.args.x ?? p.x + 24);
  const seedZ = Number(ctx.args.z ?? p.z + 24);
  const site = findSite(ctx, seedX, seedZ, width, depth, p.y - 24, p.y + 12);
  if (!site) {
    throw new Error(`couldn't find a clear flat area near (${seedX}, ${seedZ})`);
  }

  const { minX, minZ, baseY } = site;
  const maxX = minX + width - 1;
  const maxZ = minZ + depth - 1;
  const midX = Math.floor((minX + maxX) / 2);
  const midZ = Math.floor((minZ + maxZ) / 2);

  const floorY = baseY + 1;
  const wallStartY = baseY + 2;
  const wallTopY = baseY + 6;
  const roofBaseY = wallTopY + 1;

  ctx.log(`building a large house at (${minX}, ${baseY}, ${minZ})`);

  // Stand off to the west so we do not obstruct the build footprint.
  await ctx.nav.goto(new Vec3(minX - 4, baseY, midZ), 2, ctx.signal);

  const placements: Placement[] = [];

  // Foundation and interior floor.
  placements.push(...platform(new Vec3(minX, baseY, minZ), width, depth, "cobbled_deepslate"));
  placements.push(...platform(new Vec3(minX, floorY, minZ), width, depth, "oak_planks"));

  // Main shell with cutouts for the front door and windows.
  for (let y = wallStartY; y <= wallTopY; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const onPerimeter = x === minX || x === maxX || z === minZ || z === maxZ;
        if (!onPerimeter) continue;

        const frontDoor = z === minZ && x === midX && (y === wallStartY || y === wallStartY + 1);
        const frontWindow = z === minZ && Math.abs(x - midX) <= 3 && (y === wallStartY + 2 || y === wallStartY + 3);
        const sideWindows =
          ((x === minX || x === maxX) && (z === minZ + 4 || z === minZ + 5 || z === minZ + 11 || z === minZ + 12) &&
            (y === wallStartY + 1 || y === wallStartY + 2));
        const rearWindow = z === maxZ && Math.abs(x - midX) <= 2 && (y === wallStartY + 1 || y === wallStartY + 2);

        if (frontDoor) continue;
        if (frontWindow || sideWindows || rearWindow) {
          placements.push({ pos: new Vec3(x, y, z), block: "glass" });
        } else {
          placements.push({ pos: new Vec3(x, y, z), block: "diorite" });
        }
      }
    }
  }

  // Corner and entry supports.
  const corners: Array<[number, number]> = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
  ];
  for (const [x, z] of corners) {
    for (let y = wallStartY; y <= wallTopY + 1; y++) {
      placements.push({ pos: new Vec3(x, y, z), block: "oak_log" });
    }
  }

  // Porch.
  const porchMinX = midX - 2;
  const porchMaxX = midX + 2;
  const porchMinZ = minZ - 3;
  const porchMaxZ = minZ - 1;
  placements.push(...platform(new Vec3(porchMinX, floorY, porchMinZ), 5, 3, "oak_planks"));
  placements.push({ pos: new Vec3(midX - 1, floorY + 1, minZ - 1), block: "cobblestone" });
  placements.push({ pos: new Vec3(midX + 1, floorY + 1, minZ - 1), block: "cobblestone" });
  placements.push({ pos: new Vec3(midX, floorY + 1, minZ - 2), block: "cobblestone" });
  placements.push({ pos: new Vec3(midX, floorY + 1, minZ - 1), block: "cobblestone" });
  placements.push({ pos: new Vec3(midX, floorY + 1, minZ), block: "oak_door" });
  placements.push({ pos: new Vec3(midX, floorY + 2, minZ), block: "oak_door" });

  // Porch posts and awning.
  for (const [x, z] of [
    [porchMinX, porchMinZ],
    [porchMaxX, porchMinZ],
    [porchMinX, porchMaxZ],
    [porchMaxX, porchMaxZ],
  ]) {
    for (let y = floorY + 1; y <= roofBaseY - 1; y++) {
      placements.push({ pos: new Vec3(x, y, z), block: "oak_log" });
    }
  }
  placements.push(...platform(new Vec3(porchMinX, roofBaseY - 1, porchMinZ), 5, 3, "cobbled_deepslate"));

  // Stepped main roof.
  const roofLayers = 5;
  for (let i = 0; i < roofLayers; i++) {
    const inset = i * 2;
    const layerMinX = minX + inset;
    const layerMinZ = minZ + inset;
    const layerWidth = width - inset * 2;
    const layerDepth = depth - inset * 2;
    if (layerWidth <= 0 || layerDepth <= 0) break;
    const material = i === 0 ? "oak_wood" : "cobbled_deepslate";
    placements.push(...platform(new Vec3(layerMinX, roofBaseY + i, layerMinZ), layerWidth, layerDepth, material));
  }

  // Rear tower.
  const towerSize = 7;
  const towerMinX = midX - 3;
  const towerMinZ = maxZ - 6;
  const towerBaseY = roofBaseY + 1;
  const towerTopY = towerBaseY + 6;
  for (let y = towerBaseY; y <= towerTopY; y++) {
    for (let x = towerMinX; x < towerMinX + towerSize; x++) {
      for (let z = towerMinZ; z < towerMinZ + towerSize; z++) {
        const onPerimeter = x === towerMinX || x === towerMinX + towerSize - 1 || z === towerMinZ || z === towerMinZ + towerSize - 1;
        if (!onPerimeter) continue;

        const towerWindow =
          (x === towerMinX || x === towerMinX + towerSize - 1) &&
          (z === towerMinZ + 2 || z === towerMinZ + 4) &&
          (y === towerBaseY + 2 || y === towerBaseY + 3);

        if (towerWindow) {
          placements.push({ pos: new Vec3(x, y, z), block: "glass" });
        } else {
          placements.push({ pos: new Vec3(x, y, z), block: "diorite" });
        }
      }
    }
  }
  placements.push(...pyramidPlacements(midX, towerTopY + 1, towerMinZ + 3, towerSize, "cobbled_deepslate"));

  // Small chimney for character.
  for (let y = roofBaseY + 2; y <= roofBaseY + 5; y++) {
    placements.push({ pos: new Vec3(minX + 4, y, minZ + 4), block: "cobbled_deepslate" });
  }

  await clearConflicts(ctx, placements);
  const summary = await buildStructure(ctx, placements);
  return `house built: ${summary}`;
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
  return block.name === "air" || block.name === "cave_air" || block.name === "void_air" || block.name === "water" || block.name.includes("grass");
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

async function clearConflicts(ctx: SkillContext, placements: Placement[]): Promise<void> {
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
