/** Direct test of armor equipping (no Codex). Joins, prints inventory + slots,
 *  tries equipArmor(), then reads back. Stop other instances first.
 *  Usage: $env:MINEAGENT_PORT="NNNNN"; npx tsx src/bot/armor-probe.ts */
import { loadConfig, agentNames } from "../config.js";
import { AgentBot } from "./agent-bot.js";
import { Navigator } from "./navigator.js";
import { Actions } from "./actions.js";

const cfg = loadConfig();
const agent = new AgentBot(cfg, agentNames(cfg)[0]);
await agent.start();
const bot = agent.bot;
const nav = new Navigator(bot);
const actions = new Actions(bot, nav);

const dump = (label: string) => {
  console.log(`\n=== ${label} ===`);
  console.log("gamemode:", bot.game.gameMode);
  console.log("inventory items:", bot.inventory.items().map((i) => `${i.name}@slot${i.slot}`).join(", ") || "(none)");
  console.log("armor slots[5-8]:", [5, 6, 7, 8].map((s) => bot.inventory.slots[s]?.name ?? "empty").join(", "));
};

try {
  await new Promise((r) => setTimeout(r, 800)); // let inventory populate
  dump("BEFORE");

  console.log("\ncalling equipArmor()...");
  try {
    const res = await actions.equipArmor();
    console.log("equipArmor returned:", res);
  } catch (err) {
    console.error("equipArmor threw:", err instanceof Error ? err.message : err);
  }

  await new Promise((r) => setTimeout(r, 800));
  dump("AFTER");
} finally {
  setTimeout(() => { agent.stop(); process.exit(0); }, 500);
}
