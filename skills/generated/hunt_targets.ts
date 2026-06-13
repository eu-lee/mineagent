import { Vec3 } from "vec3";
import prismarineBlock from "prismarine-block";
import type { SkillContext } from "../../src/skills/runtime.js";

type Target = {
  name: string;
  x: number;
  y: number;
  z: number;
};

export async function run(ctx: SkillContext): Promise<string> {
  patchDigTime(ctx.bot.version);

  const rawTargets = ctx.args.targets;
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    throw new Error("expected args.targets to be a non-empty array");
  }

  const targets: Target[] = rawTargets.map((t, i) => {
    if (!t || typeof t !== "object") throw new Error(`target ${i} must be an object`);
    const name = String((t as Target).name ?? "");
    const x = Number((t as Target).x);
    const y = Number((t as Target).y);
    const z = Number((t as Target).z);
    if (!name || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`target ${i} is missing name/x/y/z`);
    }
    return { name, x, y, z };
  });

  for (const target of targets) {
    if (ctx.signal.aborted) break;
    ctx.log(`tunneling to ${target.name} at (${target.x}, ${target.y}, ${target.z})`);
    await tunnelTo(ctx, target.x, target.y, target.z);
    if (ctx.signal.aborted) break;

    ctx.log(`attacking ${target.name}`);
    try {
      await ctx.actions.attack(target.name, ctx.signal);
    } catch (err) {
      // If the player is not directly visible yet, make one last position fix
      // and try again after the tunnel reached the target coordinates.
      ctx.log(`repositioning for ${target.name}`);
      await ctx.actions.gotoXYZ(target.x, target.y, target.z, 1, ctx.signal);
      await ctx.actions.attack(target.name, ctx.signal);
    }
  }

  return `handled ${targets.map((t) => t.name).join(", ")}`;
}

async function tunnelTo(ctx: SkillContext, tx: number, ty: number, tz: number): Promise<void> {
  // First drop to the target Y by digging the floor below us one block at a time.
  while (!ctx.signal.aborted && Math.floor(ctx.bot.entity.position.y) > ty) {
    const pos = ctx.bot.entity.position.floored();
    const below = ctx.bot.blockAt(pos.offset(0, -1, 0));
    if (below && below.name !== "air" && below.name !== "water" && below.name !== "lava") {
      await digBlock(ctx, below.position.x, below.position.y, below.position.z);
    } else {
      await ctx.nav.goto(new Vec3(pos.x, pos.y - 1, pos.z), 0, ctx.signal);
    }
    await waitForDrop(ctx, pos.y);
  }

  // Then travel horizontally in X, then Z, carving one block at a time.
  await carveAxis(ctx, "x", tx, ty, tz);
  await carveAxis(ctx, "z", tx, ty, tz);
}

async function carveAxis(
  ctx: SkillContext,
  axis: "x" | "z",
  tx: number,
  ty: number,
  tz: number,
): Promise<void> {
  while (!ctx.signal.aborted) {
    const pos = ctx.bot.entity.position.floored();
    const current = axis === "x" ? pos.x : pos.z;
    const target = axis === "x" ? tx : tz;
    if (current === target) return;

    const step = Math.sign(target - current);
    const next = axis === "x" ? new Vec3(current + step, ty, pos.z) : new Vec3(pos.x, ty, current + step);

    await clearDestination(ctx, next.x, next.y, next.z);
    await ctx.nav.goto(next, 0, ctx.signal);
  }
}

async function clearDestination(ctx: SkillContext, x: number, y: number, z: number): Promise<void> {
  // Clear a small corridor around the next step so pathfinding can enter it.
  const toClear = [
    new Vec3(x, y, z),
    new Vec3(x, y + 1, z),
    new Vec3(x, y + 2, z),
  ];
  for (const pos of toClear) {
    if (ctx.signal.aborted) return;
    const block = ctx.bot.blockAt(pos);
    if (block && block.name !== "air" && block.name !== "water" && block.name !== "lava" && block.boundingBox === "block") {
      await digBlock(ctx, pos.x, pos.y, pos.z).catch(() => {});
    }
  }
}

async function digBlock(ctx: SkillContext, x: number, y: number, z: number): Promise<void> {
  const block = ctx.bot.blockAt(new Vec3(x, y, z));
  if (!block || block.name === "air" || block.name === "water" || block.name === "lava" || block.boundingBox !== "block") {
    return;
  }

  const originalDigTime = block.digTime.bind(block);
  (block as typeof block & { digTime: typeof block.digTime }).digTime = function (
    heldItemType: unknown,
    creative: boolean,
    inWater: boolean,
    notOnGround: boolean,
    enchantments?: unknown,
    effects?: unknown,
  ): number {
    return originalDigTime(
      heldItemType,
      creative,
      inWater,
      notOnGround,
      Array.isArray(enchantments) ? enchantments : [],
      (effects && typeof effects === "object") ? effects as Record<string, unknown> : {},
    );
  };

  const tool = ctx.bot.inventory.items().find((item) => item.name === "netherite_pickaxe")
    ?? ctx.bot.inventory.items().find((item) => item.name === "diamond_pickaxe")
    ?? ctx.bot.inventory.items().find((item) => item.name === "iron_pickaxe")
    ?? ctx.bot.inventory.items().find((item) => item.name === "stone_pickaxe");
  if (tool) {
    if (!Array.isArray((tool as { enchantments?: unknown }).enchantments)) {
      (tool as { enchantments: unknown[] }).enchantments = [];
    }
    await ctx.bot.equip(tool, "hand").catch(() => {});
    if (ctx.bot.heldItem && !Array.isArray((ctx.bot.heldItem as { enchantments?: unknown }).enchantments)) {
      (ctx.bot.heldItem as { enchantments: unknown[] }).enchantments = [];
    }
  }

  await ctx.bot.dig(block);
}

async function waitForDrop(ctx: SkillContext, fromY: number): Promise<void> {
  const deadline = Date.now() + 2_500;
  while (!ctx.signal.aborted && Date.now() < deadline) {
    if (ctx.bot.entity.position.y < fromY - 0.1) return;
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function patchDigTime(version: string): void {
  const Block = prismarineBlock(version);
  const proto = Block.prototype as Block.prototype & { __agent3Patched?: boolean };
  if (proto.__agent3Patched) return;

  const original = proto.digTime;
  proto.digTime = function (
    heldItemType: unknown,
    creative: boolean,
    inWater: boolean,
    notOnGround: boolean,
    enchantments: unknown[] = [],
    effects: Record<string, unknown> = {},
  ): number {
    return original.call(
      this,
      heldItemType,
      creative,
      inWater,
      notOnGround,
      Array.isArray(enchantments) ? enchantments : [],
      effects,
    );
  };
  proto.__agent3Patched = true;
}
