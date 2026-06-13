import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";

function pickDirection(): { dx: number; dz: number; name: string } {
  const dirs = [
    { dx: 1, dz: 0, name: "east" },
    { dx: -1, dz: 0, name: "west" },
    { dx: 0, dz: 1, name: "south" },
    { dx: 0, dz: -1, name: "north" },
  ];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

function ringPath(cx: number, y: number, cz: number, r: number): Vec3[] {
  if (r === 0) return [new Vec3(cx, y, cz)];
  const out: Vec3[] = [];

  // Start at the east side, then walk clockwise. Each step stays adjacent to
  // the previous one so every new block has support from the ring already laid.
  out.push(new Vec3(cx + r, y, cz));
  for (let z = cz - 1; z >= cz - r; z--) out.push(new Vec3(cx + r, y, z));
  for (let x = cx + r - 1; x >= cx - r; x--) out.push(new Vec3(x, y, cz - r));
  for (let z = cz - r + 1; z <= cz + r; z++) out.push(new Vec3(cx - r, y, z));
  for (let x = cx - r + 1; x <= cx + r; x++) out.push(new Vec3(x, y, cz + r));
  return out;
}

async function placeRing(
  ctx: SkillContext,
  points: Vec3[],
  block: string,
  label: string,
): Promise<void> {
  let i = 0;
  for (const pos of points) {
    if (ctx.signal.aborted) throw new Error("build aborted");
    await placeIfNeeded(ctx, pos, block);
    i++;
    if (i % 16 === 0) ctx.log(`${label}: placed ${i}/${points.length}`);
  }
}

async function placeIfNeeded(ctx: SkillContext, pos: Vec3, block: string): Promise<void> {
  const existing = ctx.bot.blockAt(pos);
  if (existing && existing.name === block) return;
  await ctx.actions.placeBlockAt(block, pos.x, pos.y, pos.z, ctx.signal);
}

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const distance = Number(ctx.args.distance ?? 22);
  const { dx, dz, name } = pickDirection();

  const dest = new Vec3(p.x + dx * distance, p.y, p.z + dz * distance);

  ctx.log(`moving ${name} first, then building there`);

  // Go out in a random direction, then step aside so the build footprint stays clear.
  await ctx.nav.goto(dest, 2, ctx.signal);
  await ctx.actions.pillarUp("cobblestone", 4, ctx.signal);

  const build = ctx.bot.entity.position.floored();
  const cx = build.x;
  const cz = build.z;
  const baseY = build.y - 1;
  const half = 2;
  const wallTop = baseY + 4;
  const roofY = baseY + 5;

  ctx.log(`building the house on the pillar at (${cx}, ${baseY}, ${cz})`);

  // Floor: center first, then rings outward so every new block has support.
  await placeIfNeeded(ctx, new Vec3(cx, baseY, cz), "cobblestone");
  for (let r = 1; r <= half; r++) {
    await placeRing(ctx, ringPath(cx, baseY, cz, r), "cobblestone", `floor r${r}`);
  }

  // Walls: each level is a supported perimeter ring. Keep the front opening free
  // for the door and leave a few slots for windows.
  const door = new Set([
    `${cx},${baseY + 1},${cz - half}`,
    `${cx},${baseY + 2},${cz - half}`,
  ]);
  const frontWindows = new Set([
    `${cx - 1},${baseY + 2},${cz - half}`,
    `${cx + 1},${baseY + 2},${cz - half}`,
  ]);
  const sideWindows = new Set([
    `${cx - half},${baseY + 2},${cz - 1}`,
    `${cx - half},${baseY + 3},${cz - 1}`,
    `${cx + half},${baseY + 2},${cz - 1}`,
    `${cx + half},${baseY + 3},${cz - 1}`,
    `${cx - 1},${baseY + 2},${cz + half}`,
    `${cx + 1},${baseY + 2},${cz + half}`,
  ]);
  for (let y = baseY + 1; y <= wallTop; y++) {
    const layer = ringPath(cx, y, cz, half);
    for (const pos of layer) {
      if (ctx.signal.aborted) throw new Error("build aborted");
      const key = `${pos.x},${pos.y},${pos.z}`;
      if ((y <= baseY + 2 && door.has(key)) || frontWindows.has(key) || sideWindows.has(key)) continue;
      await placeIfNeeded(ctx, pos, "spruce_planks");
    }
  }

  // Door and windows into the gaps we left in the walls.
  await placeIfNeeded(ctx, new Vec3(cx, baseY + 1, cz - half), "oak_door");
  await placeIfNeeded(ctx, new Vec3(cx, baseY + 2, cz - half), "oak_door");
  for (const [x, y, z] of [
    [cx - 1, baseY + 2, cz - half],
    [cx + 1, baseY + 2, cz - half],
    [cx - half, baseY + 2, cz - 1],
    [cx - half, baseY + 3, cz - 1],
    [cx + half, baseY + 2, cz - 1],
    [cx + half, baseY + 3, cz - 1],
    [cx - 1, baseY + 2, cz + half],
    [cx + 1, baseY + 2, cz + half],
  ]) {
    await placeIfNeeded(ctx, new Vec3(x, y, z), "glass");
  }

  // Roof: outer ring first, then work inward so each block can lean on the
  // already placed layer.
  for (let r = half; r >= 0; r--) {
    await placeRing(ctx, ringPath(cx, roofY, cz, r), "oak_planks", `roof r${r}`);
  }

  return `medium house done at (${cx}, ${baseY}, ${cz}) after moving ${name}`;
}
