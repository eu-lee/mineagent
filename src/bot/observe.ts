import type { Bot } from "mineflayer";
import { isCreature } from "./actions.js";

/** Block types worth calling out in observations (resources, hazards, utility). */
const NOTABLE_BLOCKS = new Set([
  "crafting_table", "furnace", "chest", "bed", "lava", "water",
  "coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore",
  "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore",
  "deepslate_gold_ore", "deepslate_diamond_ore",
  "oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log",
]);

/**
 * Compact, token-budgeted snapshot of the bot's situation for the LLM.
 * Keep this terse: it is prepended to every Codex turn.
 */
export function observe(bot: Bot): string {
  const p = bot.entity.position;
  const lines: string[] = [];

  lines.push(`position: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`);
  lines.push(`health: ${bot.health?.toFixed(0) ?? "?"}/20, food: ${bot.food?.toFixed(0) ?? "?"}/20`);
  lines.push(`time: ${bot.time.isDay ? "day" : "night"}, dimension: ${bot.game.dimension}`);
  lines.push(`gamemode: ${bot.game.gameMode}`);

  // Inventory summary
  const counts = new Map<string, number>();
  for (const it of bot.inventory.items()) counts.set(it.name, (counts.get(it.name) ?? 0) + it.count);
  lines.push(
    counts.size === 0
      ? "inventory: empty"
      : "inventory: " + [...counts.entries()].map(([n, c]) => `${c}x ${n}`).join(", "),
  );

  // Equipped: armor slots (5-8) + held item (slot 36 + bot.quickBarSlot).
  const worn = [5, 6, 7, 8]
    .map((s) => bot.inventory.slots[s])
    .filter((it): it is NonNullable<typeof it> => it != null)
    .map((it) => it.name);
  const held = bot.heldItem?.name;
  lines.push(`equipped: armor=[${worn.join(", ") || "none"}], hand=${held ?? "empty"}`);

  // Nearby players and creatures (within 32 blocks)
  const nearby = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(p) < 32)
    .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
  const players = nearby.filter((e) => e.type === "player");
  const creatures = nearby.filter(isCreature);
  if (players.length > 0) {
    lines.push(
      "players nearby: " +
        players
          .slice(0, 5)
          .map((e) => `${e.username} (${Math.round(e.position.distanceTo(p))}m)`)
          .join(", "),
    );
  }
  if (creatures.length > 0) {
    // Counts per type, plus exact position of the nearest of each (so the LLM
    // can walk to it via goto_entity / goto instead of guessing and digging).
    const seen = new Set<string>();
    const nearest: string[] = [];
    const counts = new Map<string, number>();
    for (const m of creatures) {
      const n = m.name ?? "unknown";
      counts.set(n, (counts.get(n) ?? 0) + 1);
      if (!seen.has(n) && nearest.length < 6) {
        seen.add(n);
        const cp = m.position;
        nearest.push(`${n} ${Math.round(cp.distanceTo(p))}m @(${Math.round(cp.x)},${Math.round(cp.y)},${Math.round(cp.z)})`);
      }
    }
    lines.push("mobs nearby: " + [...counts.entries()].map(([n, c]) => `${c}x ${n}`).join(", "));
    lines.push("nearest of each: " + nearest.join("; "));
  }

  // Notable blocks within 16 blocks (nearest of each type)
  const notable = new Map<string, number>();
  const found = bot.findBlocks({
    matching: (b) => NOTABLE_BLOCKS.has(b.name),
    maxDistance: 16,
    count: 64,
  });
  for (const pos of found) {
    const b = bot.blockAt(pos);
    if (!b) continue;
    const d = Math.round(pos.distanceTo(p));
    const prev = notable.get(b.name);
    if (prev === undefined || d < prev) notable.set(b.name, d);
  }
  if (notable.size > 0) {
    lines.push(
      "notable blocks: " +
        [...notable.entries()]
          .sort((a, b) => a[1] - b[1])
          .slice(0, 10)
          .map(([n, d]) => `${n} (${d}m)`)
          .join(", "),
    );
  }

  return lines.join("\n");
}
