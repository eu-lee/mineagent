import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { Navigator, NavigationError, NavigationAborted } from "./navigator.js";

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

  /**
   * Attack a target until it dies (or the signal aborts). The target may be a
   * mob/animal by name, another player/agent by username, "nearest" (closest
   * creature), or "nearest player". Approaches into melee reach, equips the
   * best weapon, then swings on the attack cooldown, re-approaching as it flees.
   */
  async attack(name: string, signal?: AbortSignal): Promise<string> {
    const t = name.trim().toLowerCase();
    let target;
    if (/^(nearest|closest|any) ?player$/.test(t)) {
      target = this.bot.nearestEntity((e) => e.type === "player");
    } else if (/^(nearest|closest|any)( ?creature| ?mob)?$/.test(t)) {
      target = this.bot.nearestEntity((e) => isCreature(e));
    } else {
      // A mob by name, or a player/agent by username.
      target = this.findEntity(name) ?? this.findPlayerEntity(name);
    }
    if (!target) throw new ActionError(`no "${name}" to attack nearby`);
    return this.attackEntity(target, signal);
  }

  /** Fight a specific entity to the death (or until aborted). Used by attack() and survival. */
  async attackEntity(target: Entity, signal?: AbortSignal): Promise<string> {
    const label = entityLabel(target);
    await this.equipWeapon();

    let hits = 0;
    let misses = 0;
    while (target.isValid && !signal?.aborted) {
      const dist = this.bot.entity.position.distanceTo(target.position);
      if (dist > 3.5) {
        try {
          await this.nav.gotoEntity(target, 2, signal);
        } catch (err) {
          if (err instanceof NavigationAborted) break;
          if (++misses >= 3) {
            return `couldn't reach ${label} to attack (gave up after ${hits} hit(s))`;
          }
          continue;
        }
        continue;
      }
      misses = 0;
      await this.bot.lookAt(target.position.offset(0, 1, 0), true).catch(() => {});
      this.bot.attack(target);
      hits++;
      await sleep(600); // melee cooldown
    }

    const outcome = !target.isValid ? "killed" : signal?.aborted ? "stopped" : "done";
    return `attacked ${label} — ${hits} hit(s), ${outcome}`;
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

    // Hardcoded path for the awkward "block under my feet" case: bot.placeBlock
    // can't place into the cell the bot occupies, so hop up and place beneath.
    if (target.equals(this.bot.entity.position.floored())) {
      return this.placeUnderFeet(itemName, signal);
    }

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

  /**
   * Place a block in the cell the bot is standing in by hopping up onto it
   * ("pillar up"). This is the hardcoded handling for placing a block under the
   * bot's feet, which `bot.placeBlock` cannot do directly because the bot's body
   * occupies the target cell — we jump and place at the apex when the cell is
   * momentarily clear, retrying on each hop until it lands.
   */
  async placeUnderFeet(itemName: string, signal?: AbortSignal): Promise<string> {
    const item = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!item) throw new ActionError(`no ${itemName} in inventory`);

    const ref = this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0));
    if (!ref || ref.boundingBox !== "block") {
      throw new ActionError("nothing solid under my feet to pillar up from");
    }

    await this.bot.equip(item, "hand");
    await this.bot.look(this.bot.entity.yaw, -Math.PI / 2, true); // look straight down
    await this.hopAndPlace(ref, new Vec3(0, 1, 0), signal);
    return `placed ${itemName} under my feet (pillared up)`;
  }

  /** Pillar straight up `count` blocks, placing one block under the feet each hop. */
  async pillarUp(itemName: string, count = 1, signal?: AbortSignal): Promise<string> {
    let done = 0;
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      await this.placeUnderFeet(itemName, signal);
      done++;
    }
    return `pillared up ${done}/${count} block(s) with ${itemName}`;
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

  /** List the contents of a container (chest/barrel/...) at coords. */
  async listChest(x: number, y: number, z: number, signal?: AbortSignal): Promise<string> {
    const chest = await this.openChestAt(x, y, z, signal);
    try {
      const items = chest.containerItems();
      if (items.length === 0) return `container at (${x}, ${y}, ${z}) is empty`;
      const counts = new Map<string, number>();
      for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + it.count);
      return "container: " + [...counts.entries()].map(([n, c]) => `${c}x ${n}`).join(", ");
    } finally {
      chest.close();
    }
  }

  /** Deposit items into a container. Omit itemName to dump everything. */
  async depositItems(x: number, y: number, z: number, itemName?: string, count?: number, signal?: AbortSignal): Promise<string> {
    const chest = await this.openChestAt(x, y, z, signal);
    try {
      const items = itemName
        ? this.bot.inventory.items().filter((i) => i.name === itemName)
        : this.bot.inventory.items();
      if (items.length === 0) throw new ActionError(itemName ? `no ${itemName} to deposit` : "nothing to deposit");
      let moved = 0;
      for (const it of items) {
        const amount = itemName && count != null ? Math.min(count - moved, it.count) : it.count;
        if (amount <= 0) break;
        await chest.deposit(it.type, null, amount);
        moved += amount;
      }
      return `deposited ${moved}${itemName ? `x ${itemName}` : " item(s)"}`;
    } finally {
      chest.close();
    }
  }

  /** Withdraw items from a container. Omit count to take all of that item. */
  async withdrawItems(x: number, y: number, z: number, itemName: string, count?: number, signal?: AbortSignal): Promise<string> {
    const chest = await this.openChestAt(x, y, z, signal);
    try {
      const inChest = chest.containerItems().filter((i) => i.name === itemName);
      if (inChest.length === 0) throw new ActionError(`no ${itemName} in that container`);
      const want = count ?? inChest.reduce((s, i) => s + i.count, 0);
      let moved = 0;
      for (const it of inChest) {
        const amount = Math.min(want - moved, it.count);
        if (amount <= 0) break;
        await chest.withdraw(it.type, null, amount);
        moved += amount;
      }
      return `withdrew ${moved}x ${itemName}`;
    } finally {
      chest.close();
    }
  }

  /**
   * Eat food to restore hunger (health then regenerates passively). With no
   * item name, eats the best non-harmful food in inventory; already-full does
   * nothing. Returns the resulting food/health.
   */
  async eat(itemName?: string): Promise<string> {
    if ((this.bot.food ?? 20) >= 20 && !itemName) return `not hungry (food ${this.bot.food}/20)`;
    const food = itemName
      ? this.bot.inventory.items().find((i) => i.name === itemName)
      : this.bestFood();
    if (!food) throw new ActionError(itemName ? `no ${itemName} in inventory` : "no food in inventory to eat");

    await this.bot.equip(food, "hand");
    try {
      await this.bot.consume();
    } catch (err) {
      throw new ActionError(`couldn't eat ${food.name}: ${err instanceof Error ? err.message : err}`);
    }
    return `ate ${food.name} — food ${this.bot.food}/20, health ${Math.round(this.bot.health ?? 0)}/20`;
  }

  /** Highest-nutrition non-harmful, non-precious food in inventory (for auto-eat). */
  private bestFood() {
    const foods = this.bot.registry.foods as Record<number, { foodPoints: number; saturation: number }>;
    const candidates = this.bot.inventory.items().filter((i) => foods[i.type] && !SKIP_AUTO_FOODS.has(i.name));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => foods[b.type].foodPoints - foods[a.type].foodPoints);
    return candidates[0];
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

  /** A player/agent's entity by username (case-insensitive), if in range. */
  findPlayerEntity(name: string): Entity | null {
    const direct = this.bot.players[name]?.entity;
    if (direct) return direct;
    const key = Object.keys(this.bot.players).find((u) => u.toLowerCase() === name.toLowerCase());
    return (key && this.bot.players[key]?.entity) || null;
  }

  /**
   * Jump once and place a block against `ref` on `face` while airborne. The bot
   * must rise ~1 block before the cell above `ref` (where its feet were) is
   * clear enough to accept the block; jump is held so it keeps hopping and we
   * retry each apex until placement succeeds, aborts, or times out.
   */
  private hopAndPlace(ref: Block, face: Vec3, signal?: AbortSignal): Promise<void> {
    const bot = this.bot;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let attempts = 0;
      let jumping = false;
      let startY = bot.entity.position.y;
      let prevDy = -1;

      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        bot.setControlState("jump", false);
        bot.removeListener("physicsTick", tick);
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve();
      };
      const onAbort = (): void => finish(new ActionError("pillar aborted"));

      const onTick = async (): Promise<void> => {
        if (settled) return;
        if (!jumping) {
          // Begin a hop.
          startY = bot.entity.position.y;
          prevDy = -1;
          jumping = true;
          bot.setControlState("jump", true);
          return;
        }
        const dy = bot.entity.position.y - startY;
        // Place at the APEX (cell maximally clear): risen ≥1 block and no longer
        // ascending. Placing too early fails AND blocks ~5s on bot.placeBlock's
        // internal timeout, so hitting the apex is what makes this reliable.
        if (dy >= 1.0 && dy <= prevDy) {
          bot.removeListener("physicsTick", tick); // pause while we place
          bot.setControlState("jump", false);
          try {
            await bot.placeBlock(ref, face);
            finish();
          } catch {
            if (++attempts >= 5) {
              finish(new ActionError("couldn't place block under feet after several hops"));
              return;
            }
            jumping = false; // try another hop
            if (!settled) bot.on("physicsTick", tick);
          }
          return;
        }
        prevDy = dy;
      };
      const tick = (): void => void onTick();

      const timer = setTimeout(
        () => finish(new ActionError("couldn't place block under feet (timed out)")),
        12_000,
      );

      if (signal) {
        if (signal.aborted) return finish(new ActionError("pillar aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
      }
      bot.on("physicsTick", tick);
    });
  }

  /** Navigate to and open a container block at coords. Caller must close it. */
  private async openChestAt(x: number, y: number, z: number, signal?: AbortSignal) {
    const target = new Vec3(x, y, z);
    const block = this.bot.blockAt(target);
    if (!block || !/chest|barrel|shulker|hopper|dispenser|dropper/.test(block.name)) {
      throw new ActionError(`no container at (${x}, ${y}, ${z})`);
    }
    await this.ensureReach(target, signal, 3);
    return this.bot.openContainer(block);
  }

  /** Equip the best available melee weapon (swords beat axes; better material wins). */
  private async equipWeapon(): Promise<void> {
    const weapons = this.bot.inventory
      .items()
      .filter((i) => i.name.endsWith("_sword") || i.name.endsWith("_axe"));
    if (weapons.length === 0) return; // bare hands
    weapons.sort((a, b) => weaponScore(b.name) - weaponScore(a.name));
    await this.bot.equip(weapons[0], "hand").catch(() => {});
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

/** Foods auto-eat / "best food" should avoid: poisonous, or too precious to burn. */
const SKIP_AUTO_FOODS = new Set([
  "rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chorus_fruit",
  "suspicious_stew", "golden_apple", "enchanted_golden_apple",
]);

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

/** Rough melee desirability: weapon type weight + material tier. */
function weaponScore(name: string): number {
  const typeScore = name.endsWith("_sword") ? 10 : 0; // swords > axes for DPS/sweep
  const mat = name.includes("netherite") ? 5
    : name.includes("diamond") ? 4
    : name.includes("iron") ? 3
    : name.includes("stone") ? 2
    : name.includes("golden") || name.includes("wooden") ? 1
    : 0;
  return typeScore + mat;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtVec(v: Vec3): string {
  return `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})`;
}
