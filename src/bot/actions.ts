import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { Navigator, NavigationError } from "./navigator.js";

export class ActionError extends Error {}

/**
 * High-level action primitives. Every long-running action takes an
 * AbortSignal so the orchestrator's `stop` can cancel mid-flight.
 * All methods return human/LLM-readable result strings.
 */
export class Actions {
  private bot: Bot;
  private nav: Navigator;

  constructor(bot: Bot, nav: Navigator) {
    this.bot = bot;
    this.nav = nav;
  }

  async gotoXYZ(x: number, y: number, z: number, range = 1, signal?: AbortSignal): Promise<string> {
    const res = await this.nav.goto(new Vec3(x, y, z), range, signal);
    return `reached ${fmtVec(res.reached)} (${res.distanceToGoal.toFixed(1)} blocks from goal) in ${(res.elapsedMs / 1000).toFixed(1)}s`;
  }

  async gotoPlayer(username: string, range = 2, signal?: AbortSignal): Promise<string> {
    const player = this.bot.players[username];
    if (!player?.entity) throw new ActionError(`player "${username}" not visible (too far away or offline)`);
    const res = await this.nav.goto(player.entity.position.clone(), range, signal);
    return `reached ${username} at ${fmtVec(res.reached)} in ${(res.elapsedMs / 1000).toFixed(1)}s`;
  }

  /** Follow a player until the signal aborts. */
  async followPlayer(username: string, range = 3, signal?: AbortSignal): Promise<string> {
    const player = this.bot.players[username];
    if (!player?.entity) throw new ActionError(`player "${username}" not visible`);
    await this.nav.follow(player.entity.id as number, range, signal);
    return `stopped following ${username}`;
  }

  /** Find the nearest creature/mob by name (e.g. "pig", "zombie") and walk to it. */
  async gotoEntity(name: string, range = 2, signal?: AbortSignal): Promise<string> {
    const target = this.findEntity(name);
    if (!target) {
      throw new ActionError(
        `no ${name} visible nearby — call observe to see what's actually around before searching`,
      );
    }
    const label = entityLabel(target);
    const res = await this.nav.gotoEntity(target, range, signal);
    return `reached ${label} at ${fmtVec(res.reached)} (${res.distanceToGoal.toFixed(1)} blocks away) in ${(res.elapsedMs / 1000).toFixed(1)}s`;
  }

  /** Find the nearest block of a type and walk adjacent to it. */
  async gotoBlock(blockName: string, maxDistance = 64, signal?: AbortSignal): Promise<string> {
    const block = this.findBlock(blockName, maxDistance);
    if (!block) throw new ActionError(`no ${blockName} found within ${maxDistance} blocks`);
    await this.nav.goto(block.position, 2, signal);
    return `standing next to ${blockName} at ${fmtVec(block.position)}`;
  }

  /** Dig the block at exact coordinates. */
  async digBlockAt(x: number, y: number, z: number, signal?: AbortSignal): Promise<string> {
    const block = this.bot.blockAt(new Vec3(x, y, z));
    if (!block || block.name === "air") throw new ActionError(`no block at (${x}, ${y}, ${z})`);
    await this.ensureReach(block.position, signal);
    await this.equipForDig(block);
    await this.bot.dig(block);
    return `dug ${block.name} at (${x}, ${y}, ${z})`;
  }

  /** Collect n blocks of a type: find, walk, dig, pick up, repeat. */
  async collectBlocks(blockName: string, count: number, signal?: AbortSignal): Promise<string> {
    let collected = 0;
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      const block = this.findBlock(blockName, 64);
      if (!block) {
        if (collected === 0) throw new ActionError(`no ${blockName} found within 64 blocks`);
        break;
      }
      try {
        await this.nav.goto(block.position, 3, signal);
        await this.equipForDig(block);
        await this.bot.dig(block);
        collected++;
        // Walk onto the drop so it gets picked up.
        await this.nav.goto(block.position, 0, signal).catch(() => {});
      } catch (err) {
        if (err instanceof NavigationError && collected > 0) break;
        throw err;
      }
    }
    return `collected ${collected}/${count} ${blockName}`;
  }

  /**
   * Place a block of `itemName` at (x, y, z). Requires an adjacent solid
   * block to place against and the item in inventory.
   */
  async placeBlockAt(itemName: string, x: number, y: number, z: number, signal?: AbortSignal): Promise<string> {
    const target = new Vec3(x, y, z);
    const existing = this.bot.blockAt(target);
    if (existing && existing.name !== "air" && existing.name !== "water" && !existing.name.includes("grass")) {
      throw new ActionError(`(${x}, ${y}, ${z}) is already occupied by ${existing.name}`);
    }

    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) throw new ActionError(`no ${itemName} in inventory`);

    // Find a solid neighbor to place against.
    const faces = [
      new Vec3(0, -1, 0), new Vec3(0, 1, 0),
      new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
      new Vec3(0, 0, -1), new Vec3(0, 0, 1),
    ];
    let refBlock: Block | null = null;
    let face: Vec3 | null = null;
    for (const f of faces) {
      const b = this.bot.blockAt(target.plus(f));
      if (b && b.boundingBox === "block") {
        refBlock = b;
        face = f.scaled(-1);
        break;
      }
    }
    if (!refBlock || !face) throw new ActionError(`no solid block adjacent to (${x}, ${y}, ${z}) to place against`);

    await this.ensureReach(target, signal, 4);
    await this.bot.equip(item, "hand");
    await this.bot.placeBlock(refBlock, face);
    return `placed ${itemName} at (${x}, ${y}, ${z})`;
  }

  async craft(itemName: string, count = 1, signal?: AbortSignal): Promise<string> {
    const mcData = this.bot.registry;
    const item = mcData.itemsByName[itemName];
    if (!item) throw new ActionError(`unknown item "${itemName}"`);

    // Prefer recipes that don't need a table; otherwise find/walk to one.
    let craftingTable: Block | null = null;
    let recipes = this.bot.recipesFor(item.id, null, 1, null);
    if (recipes.length === 0) {
      craftingTable = this.findBlock("crafting_table", 64);
      if (!craftingTable) throw new ActionError(`no recipe for ${itemName} without a crafting table, and none found nearby`);
      await this.nav.goto(craftingTable.position, 2, signal);
      recipes = this.bot.recipesFor(item.id, null, 1, craftingTable);
      if (recipes.length === 0) throw new ActionError(`missing ingredients to craft ${itemName}`);
    }

    await this.bot.craft(recipes[0], count, craftingTable ?? undefined);
    return `crafted ${count}x ${itemName}`;
  }

  /** Hold an item in hand, OR — if it's armor — wear it in the correct slot
   *  (so a wrong tool choice by the LLM still does the right thing). */
  async equip(itemName: string): Promise<string> {
    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) throw new ActionError(`no ${itemName} in inventory`);
    const dest = armorSlot(item.name);
    if (dest) {
      await this.bot.equip(item, dest);
      return `equipped ${itemName} on ${dest}. Now wearing: ${this.wornArmor() || "nothing"}`;
    }
    await this.bot.equip(item, "hand");
    return `holding ${itemName} in hand`;
  }

  /**
   * Wear armor. With no item name, equips every armor piece found in inventory
   * to its correct slot. With a name, equips that one piece. Verifies by
   * reading back the equipped slots so we never report success falsely.
   */
  async equipArmor(itemName?: string): Promise<string> {
    const items = this.bot.inventory.items();
    const targets = itemName
      ? items.filter((i) => i.name === itemName)
      : items.filter((i) => armorSlot(i.name) !== null);

    if (targets.length === 0) {
      throw new ActionError(itemName ? `no ${itemName} in inventory` : "no armor in inventory");
    }

    const equipped: string[] = [];
    for (const item of targets) {
      const dest = armorSlot(item.name);
      if (!dest) throw new ActionError(`${item.name} is not armor`);
      await this.bot.equip(item, dest);
      equipped.push(`${item.name}→${dest}`);
    }

    // Read back what's actually worn so the report is truthful.
    const worn = this.wornArmor();
    return `equipped ${equipped.join(", ")}. Now wearing: ${worn || "nothing"}`;
  }

  /** Names of currently equipped armor pieces (head, torso, legs, feet). */
  wornArmor(): string {
    // mineflayer inventory armor slots are 5..8 (head, torso, legs, feet).
    const slots = [5, 6, 7, 8]
      .map((s) => this.bot.inventory.slots[s])
      .filter((it): it is NonNullable<typeof it> => it != null)
      .map((it) => it.name);
    return slots.join(", ");
  }

  async dropItems(itemName: string, count?: number): Promise<string> {
    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) throw new ActionError(`no ${itemName} in inventory`);
    await this.bot.toss(item.type, null, count ?? item.count);
    return `dropped ${count ?? item.count}x ${itemName}`;
  }

  inventory(): string {
    const items = this.bot.inventory.items();
    if (items.length === 0) return "inventory is empty";
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + it.count);
    return [...counts.entries()].map(([n, c]) => `${c}x ${n}`).join(", ");
  }

  // --- helpers ---

  findBlock(blockName: string, maxDistance: number): Block | null {
    const mcData = this.bot.registry;
    const def = mcData.blocksByName[blockName];
    if (!def) throw new ActionError(`unknown block type "${blockName}"`);
    return this.bot.findBlock({ matching: def.id, maxDistance });
  }

  /**
   * Nearest living creature whose name matches `name` (case-insensitive,
   * spaces→underscores). Players and dropped items are excluded. Falls back to
   * a substring match so "skeleton" finds "wither_skeleton" etc.
   */
  findEntity(name: string): Entity | null {
    const want = name.toLowerCase().trim().replace(/\s+/g, "_");
    const exact = this.bot.nearestEntity(
      (e) => isCreature(e) && (e.name ?? "").toLowerCase() === want,
    );
    if (exact) return exact;
    return this.bot.nearestEntity(
      (e) => isCreature(e) && (e.name ?? "").toLowerCase().includes(want),
    );
  }

  /** Walk until the position is within interaction reach. */
  private async ensureReach(pos: Vec3, signal?: AbortSignal, reach = 4.5): Promise<void> {
    if (this.bot.entity.position.distanceTo(pos) <= reach) return;
    await this.nav.goto(pos, 3, signal);
  }

  /**
   * Equip the fastest tool for a block, preferring one that can actually
   * harvest it (so we don't pick a sword that mines ore but drops nothing).
   * Then verify the block is harvestable with what's now in hand — if not,
   * throw a clear error instead of uselessly punching (e.g. diamond ore with
   * bare hands or no pickaxe).
   */
  private async equipForDig(block: Block): Promise<void> {
    const items = this.bot.inventory.items();

    // Prefer harvest-capable tools; among ties, fastest dig time.
    let bestHarvest: { item: (typeof items)[number]; time: number } | null = null;
    let bestAny: { item: (typeof items)[number]; time: number } | null = null;
    for (const item of items) {
      const time = block.digTime(item.type, false, false, false, [], []);
      if (!bestAny || time < bestAny.time) bestAny = { item, time };
      if (block.canHarvest(item.type) && (!bestHarvest || time < bestHarvest.time)) {
        bestHarvest = { item, time };
      }
    }

    const choice = bestHarvest ?? bestAny;
    const bare = block.digTime(null, false, false, false, [], []);
    if (choice && choice.time < bare) {
      await this.bot.equip(choice.item, "hand").catch(() => {});
    }

    // Verify harvestability with whatever ended up in hand.
    const held = this.bot.heldItem;
    if (!block.canHarvest(held ? held.type : null)) {
      throw new ActionError(
        `can't harvest ${block.name} with ${held?.name ?? "bare hands"} — ` +
          `it needs a better tool and would break without dropping anything. ` +
          `Get/craft the right tool first (e.g. an iron+ pickaxe for diamond/gold ore).`,
      );
    }
  }
}

/** Maps an armor item name to its equip slot, or null if it isn't armor. */
function armorSlot(name: string): "head" | "torso" | "legs" | "feet" | null {
  if (/helmet|_cap$|skull|carved_pumpkin/.test(name)) return "head";
  if (/chestplate|elytra|tunic/.test(name)) return "torso";
  if (/leggings|_pants$/.test(name)) return "legs";
  if (/boots/.test(name)) return "feet";
  return null;
}

/** Entity categories that count as a living creature you can walk up to. */
const CREATURE_TYPES = new Set([
  "mob", "animal", "hostile", "passive", "ambient", "water_creature", "creature", "npc", "living",
]);

/** True for living mobs/animals (not players, item drops, projectiles, XP orbs). */
export function isCreature(e: Entity): boolean {
  if (!e || e.type === "player" || e.type === "object" || e.type === "orb" || e.type === "projectile") {
    return false;
  }
  // Some versions only set generic types; require a name and exclude obvious items.
  if (!e.name) return false;
  if (e.type && CREATURE_TYPES.has(e.type)) return true;
  // Fallback: anything named that isn't an item/experience entity.
  return e.name !== "item" && e.name !== "experience_orb" && e.name !== "arrow";
}

function entityLabel(e: Entity): string {
  return e.username ?? e.displayName ?? e.name ?? "entity";
}

function fmtVec(v: Vec3): string {
  return `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})`;
}
