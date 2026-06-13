/**
 * Scripted smoke test for Phase 2 primitives against a running local server.
 * Usage: npm run smoke   (server must be up; bot joins as <username>-smoke)
 */
import { loadConfig, agentNames } from "./config.js";
import { AgentBot } from "./bot/agent-bot.js";
import { Navigator } from "./bot/navigator.js";
import { Actions } from "./bot/actions.js";
import { observe } from "./bot/observe.js";
import { Vec3 } from "vec3";

const cfg = loadConfig();
const agent = new AgentBot(cfg, `${agentNames(cfg)[0]}smoke`);
await agent.start();
const nav = new Navigator(agent.bot);
const actions = new Actions(agent.bot, nav);
const bot = agent.bot;

function step(name: string) {
  console.log(`\n=== ${name} ===`);
}

try {
  step("observe");
  console.log(observe(bot));

  step("goto +10x");
  const p = bot.entity.position;
  console.log(await actions.gotoXYZ(Math.round(p.x) + 10, Math.round(p.y), Math.round(p.z), 1));

  step("place + dig (needs creative /give)");
  bot.chat(`/give ${bot.username} dirt 1`);
  await new Promise((r) => setTimeout(r, 800));
  const here = bot.entity.position.floored();
  const spot = new Vec3(here.x + 2, here.y, here.z);
  console.log(await actions.placeBlockAt("dirt", spot.x, spot.y, spot.z));
  console.log(await actions.digBlockAt(spot.x, spot.y, spot.z));

  step("inventory");
  console.log(actions.inventory());

  step("abort mid-goto");
  const controller = new AbortController();
  const far = actions.gotoXYZ(Math.round(p.x) + 200, Math.round(p.y), Math.round(p.z), 1, controller.signal);
  setTimeout(() => controller.abort(), 3000);
  await far.then(
    (r) => console.log("unexpected completion:", r),
    (e) => console.log("aborted as expected:", e.message),
  );

  console.log("\nSMOKE OK");
} catch (err) {
  console.error("\nSMOKE FAILED:", err);
  process.exitCode = 1;
} finally {
  agent.stop();
  process.exit();
}
