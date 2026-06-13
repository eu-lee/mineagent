import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";

export interface Placement {
  pos: Vec3;
  block: string;
}

/**
 * Place a list of blocks, navigating as needed. Placements are de-duplicated
 * (last one wins per coordinate) and ordered bottom-up so each block has
 * support below it; within a layer the bot greedily visits the nearest cell to
 * cut down on wandering. Positions already holding the right block are skipped.
 *
 * Materials: if `creativeGive` is set (defaults to ctx.creativeGive), missing
 * blocks are `/give`n; otherwise a shortfall throws so the skill can gather first.
 *
 * NOTE: placement needs a solid block to place against (floor or an
 * already-placed neighbour). Build on/above the ground; fully floating shapes
 * with no support will report placement failures.
 */
export async function buildStructure(
  ctx: SkillContext,
  placements: Placement[],
  opts: { creativeGive?: boolean } = {},
): Promise<string> {
  const { actions, bot, signal } = ctx;
  const creativeGive = opts.creativeGive ?? ctx.creativeGive ?? false;

  // De-dupe by coordinate (last write wins).
  const byKey = new Map<string, Placement>();
  for (const p of placements) byKey.set(key(p.pos), p);
  const unique = [...byKey.values()];

  // Order: layer by layer (y asc); within a layer, greedy nearest-first from
  // the bot's current column so it doesn't leapfrog across the build.
  const ordered = orderForBuild(unique, bot.entity.position);

  // Material check / top-up.
  const needed = new Map<string, number>();
  for (const p of ordered) needed.set(p.block, (needed.get(p.block) ?? 0) + 1);
  for (const [block, count] of needed) {
    const have = bot.inventory.items().filter((i) => i.name === block).reduce((s, i) => s + i.count, 0);
    if (have < count) {
      if (creativeGive) {
        bot.chat(`/give ${bot.username} ${block} ${count - have}`);
        await sleep(500);
      } else {
        throw new Error(`not enough ${block}: need ${count}, have ${have} — gather more first`);
      }
    }
  }

  let placed = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const { pos, block } of ordered) {
    if (signal.aborted) throw new Error("build aborted");
    const existing = bot.blockAt(pos);
    if (existing && existing.name === block) {
      skipped++;
      continue;
    }
    try {
      await actions.placeBlockAt(block, pos.x, pos.y, pos.z, signal);
      placed++;
      if (placed % 20 === 0) ctx.log(`placed ${placed}/${ordered.length} blocks...`);
    } catch (err) {
      failures.push(`(${pos.x},${pos.y},${pos.z}): ${err instanceof Error ? err.message : err}`);
      if (failures.length > 10) throw new Error(`too many placement failures; first: ${failures[0]}`);
    }
  }

  let summary = `placed ${placed} blocks` + (skipped ? `, ${skipped} already in place` : "");
  if (failures.length) summary += `, ${failures.length} failed (e.g. ${failures[0]})`;
  return summary;
}

// ---------------------------------------------------------------------------
// Shape generators — pure functions returning Placement[]. Compose these and
// hand the result to buildStructure. All coordinates are absolute world coords.
// ---------------------------------------------------------------------------

/** Filled axis-aligned box between two corners (inclusive). */
export function cuboid(c1: Vec3, c2: Vec3, block: string): Placement[] {
  const [x1, x2] = minmax(c1.x, c2.x);
  const [y1, y2] = minmax(c1.y, c2.y);
  const [z1, z2] = minmax(c1.z, c2.z);
  const out: Placement[] = [];
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++) out.push({ pos: new Vec3(x, y, z), block });
  return out;
}

/**
 * Hollow box (shell) between two corners. By default only the four vertical
 * walls; enable `floor`/`ceiling` for a closed room.
 */
export function hollowBox(
  c1: Vec3,
  c2: Vec3,
  block: string,
  opts: { walls?: boolean; floor?: boolean; ceiling?: boolean } = {},
): Placement[] {
  const walls = opts.walls ?? true;
  const [x1, x2] = minmax(c1.x, c2.x);
  const [y1, y2] = minmax(c1.y, c2.y);
  const [z1, z2] = minmax(c1.z, c2.z);
  const out: Placement[] = [];
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++) {
        const onWall = walls && (x === x1 || x === x2 || z === z1 || z === z2);
        const onFloor = opts.floor && y === y1;
        const onCeil = opts.ceiling && y === y2;
        if (onWall || onFloor || onCeil) out.push({ pos: new Vec3(x, y, z), block });
      }
  return out;
}

/** Flat rectangle (single layer) at `corner.y`, spanning width on x and length on z. */
export function platform(corner: Vec3, width: number, length: number, block: string): Placement[] {
  return cuboid(corner, new Vec3(corner.x + width - 1, corner.y, corner.z + length - 1), block);
}

/** A straight wall: a horizontal line from `from` to `to` raised `height` blocks. */
export function wall(from: Vec3, to: Vec3, height: number, block: string): Placement[] {
  const base = lineXZ(from, to);
  const out: Placement[] = [];
  for (const b of base) for (let h = 0; h < height; h++) out.push({ pos: new Vec3(b.x, from.y + h, b.z), block });
  return out;
}

/** Vertical cylinder. `center` is the bottom-centre; filled unless `hollow`. */
export function cylinder(
  center: Vec3,
  radius: number,
  height: number,
  block: string,
  opts: { hollow?: boolean } = {},
): Placement[] {
  const out: Placement[] = [];
  const r = radius;
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      const inside = dist <= r + 0.5;
      const shell = Math.abs(dist - r) < 0.75;
      if (opts.hollow ? shell : inside) {
        for (let y = 0; y < height; y++) out.push({ pos: new Vec3(center.x + dx, center.y + y, center.z + dz), block });
      }
    }
  return out;
}

/** Sphere centred at `center`; filled unless `hollow`. */
export function sphere(center: Vec3, radius: number, block: string, opts: { hollow?: boolean } = {}): Placement[] {
  return ball(center, radius, block, opts.hollow ?? false, false);
}

/** Top half of a hollow sphere — a dome. `center` is the base centre. */
export function dome(center: Vec3, radius: number, block: string): Placement[] {
  return ball(center, radius, block, true, true);
}

/** Solid pyramid; set `hollow` for a stepped open frame (outer ring per layer). */
export function pyramidPlacements(
  cx: number,
  baseY: number,
  cz: number,
  baseSize: number,
  block: string,
  opts: { hollow?: boolean } = {},
): Placement[] {
  const placements: Placement[] = [];
  let half = Math.floor(baseSize / 2);
  let y = baseY;
  while (half >= 0) {
    for (let dx = -half; dx <= half; dx++)
      for (let dz = -half; dz <= half; dz++) {
        const onRing = Math.abs(dx) === half || Math.abs(dz) === half;
        if (!opts.hollow || onRing) placements.push({ pos: new Vec3(cx + dx, y, cz + dz), block });
      }
    half--;
    y++;
  }
  return placements;
}

/** 3D line between two points (integer voxel steps). */
export function line(from: Vec3, to: Vec3, block: string): Placement[] {
  const out: Placement[] = [];
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({
      pos: new Vec3(Math.round(from.x + dx * t), Math.round(from.y + dy * t), Math.round(from.z + dz * t)),
      block,
    });
  }
  return out;
}

// --- internals ---

function ball(center: Vec3, radius: number, block: string, hollow: boolean, topOnly: boolean): Placement[] {
  const out: Placement[] = [];
  const r = radius;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = topOnly ? 0 : -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const inside = dist <= r + 0.5;
        const shell = Math.abs(dist - r) < 0.75;
        if (hollow ? shell : inside) out.push({ pos: new Vec3(center.x + dx, center.y + dy, center.z + dz), block });
      }
  return out;
}

/** Horizontal (xz-plane) line of cells at from.y between two points. */
function lineXZ(from: Vec3, to: Vec3): Vec3[] {
  const out: Vec3[] = [];
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dz)) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push(new Vec3(Math.round(from.x + dx * t), from.y, Math.round(from.z + dz * t)));
  }
  return out;
}

/** Bottom-up; within each y-layer, greedy nearest-first from the bot's column. */
function orderForBuild(placements: Placement[], origin: Vec3): Placement[] {
  const layers = new Map<number, Placement[]>();
  for (const p of placements) {
    const arr = layers.get(p.pos.y) ?? [];
    arr.push(p);
    layers.set(p.pos.y, arr);
  }
  const out: Placement[] = [];
  let cursor = origin;
  for (const y of [...layers.keys()].sort((a, b) => a - b)) {
    const remaining = layers.get(y)!;
    while (remaining.length) {
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = horizDist(cursor, remaining[i].pos);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      out.push(next);
      cursor = next.pos;
    }
  }
  return out;
}

function horizDist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function key(v: Vec3): string {
  return `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;
}

function minmax(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
