import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AgentBot } from "../bot/agent-bot.js";
import type { Actions } from "../bot/actions.js";
import type { Navigator } from "../bot/navigator.js";
import type { ActionGate } from "../bot/action-gate.js";
import { observe } from "../bot/observe.js";
import { runSkill } from "../skills/runtime.js";
import type { Config } from "../config.js";

export interface McpDeps {
  agent: AgentBot;
  actions: Actions;
  nav: Navigator;
  gate: ActionGate;
  cfg: Config;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

/** Wrap a physical action: serialize through the gate, format result/error. */
function action(deps: McpDeps, name: string, fn: (signal: AbortSignal) => Promise<string>) {
  return async (): Promise<ToolResult> => {
    try {
      return ok(await deps.gate.run(name, fn));
    } catch (err) {
      return fail(err);
    }
  };
}

function buildServer(deps: McpDeps): McpServer {
  const { agent, actions, nav, gate, cfg } = deps;
  const server = new McpServer({ name: "mineagent", version: "0.1.0" });

  server.registerTool(
    "observe",
    {
      description:
        "Get the bot's current situation: position, health, inventory, nearby players/mobs/notable blocks. Cheap — call freely.",
      inputSchema: {},
    },
    async () => ok(observe(agent.bot)),
  );

  server.registerTool(
    "goto",
    {
      description: "Walk to coordinates. Long journeys are chunked automatically.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        z: z.number(),
        range: z.number().optional().describe("stop within this many blocks (default 1)"),
      },
    },
    async ({ x, y, z, range }) => action(deps, `goto (${x},${y},${z})`, (s) => actions.gotoXYZ(x, y, z, range ?? 1, s))(),
  );

  server.registerTool(
    "goto_player",
    {
      description: "Walk to a player by username.",
      inputSchema: { username: z.string() },
    },
    async ({ username }) => action(deps, `goto ${username}`, (s) => actions.gotoPlayer(username, 2, s))(),
  );

  server.registerTool(
    "follow_player",
    {
      description: "Follow a player continuously until the stop tool is called. Returns immediately after starting.",
      inputSchema: { username: z.string() },
    },
    async ({ username }) => {
      try {
        if (gate.busyWith) return fail(new Error(`busy with "${gate.busyWith}" — stop first`));
        // Fire and forget: follow runs until stop aborts it.
        void gate.run(`follow ${username}`, (s) => actions.followPlayer(username, 3, s)).catch(() => {});
        return ok(`now following ${username} (use stop to end)`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "goto_entity",
    {
      description:
        "Walk up to the nearest living creature by name (e.g. 'pig', 'cow', 'zombie'). Tracks it as it moves and never digs to reach it. Call observe first to confirm one is nearby.",
      inputSchema: {
        name: z.string().describe("mob/animal name, e.g. 'pig'"),
        range: z.number().optional().describe("stop within this many blocks (default 2)"),
      },
    },
    async ({ name, range }) => action(deps, `goto ${name}`, (s) => actions.gotoEntity(name, range ?? 2, s))(),
  );

  server.registerTool(
    "attack",
    {
      description:
        "Attack a target until it dies (or you stop). Approaches, equips the best weapon, and swings. Target can be a mob ('zombie', 'pig'), another agent/player by name ('Agent2'), 'nearest' (closest mob), or 'nearest player'.",
      inputSchema: { target: z.string().describe("'zombie' | 'cow' | an agent/player name like 'Agent2' | 'nearest' | 'nearest player'") },
    },
    async ({ target }) => action(deps, `attack ${target}`, (s) => actions.attack(target, s))(),
  );

  server.registerTool(
    "goto_block",
    {
      description: "Find the nearest block of a type (e.g. 'oak_log', 'crafting_table') and walk next to it.",
      inputSchema: { block: z.string(), maxDistance: z.number().optional() },
    },
    async ({ block, maxDistance }) =>
      action(deps, `goto_block ${block}`, (s) => actions.gotoBlock(block, maxDistance ?? 64, s))(),
  );

  server.registerTool(
    "dig_block",
    {
      description: "Dig the block at exact coordinates (walks into reach first).",
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
    },
    async ({ x, y, z }) => action(deps, `dig (${x},${y},${z})`, (s) => actions.digBlockAt(x, y, z, s))(),
  );

  server.registerTool(
    "collect_blocks",
    {
      description: "Collect N blocks of a type: repeatedly find nearest, walk, dig, pick up. E.g. collect 10 oak_log.",
      inputSchema: { block: z.string(), count: z.number().int().min(1).max(64) },
    },
    async ({ block, count }) => action(deps, `collect ${count} ${block}`, (s) => actions.collectBlocks(block, count, s))(),
  );

  server.registerTool(
    "place_block",
    {
      description: "Place one block from inventory at exact coordinates (needs a solid adjacent block).",
      inputSchema: { item: z.string(), x: z.number(), y: z.number(), z: z.number() },
    },
    async ({ item, x, y, z }) => action(deps, `place ${item}`, (s) => actions.placeBlockAt(item, x, y, z, s))(),
  );

  server.registerTool(
    "pillar_up",
    {
      description:
        "Pillar straight up by placing blocks under your own feet (hop-and-place). Use this to gain height or when a block needs to go in the cell you're standing in — normal place_block can't do that.",
      inputSchema: {
        item: z.string().describe("block to place, e.g. 'dirt', 'cobblestone'"),
        count: z.number().int().min(1).max(64).optional().describe("how many blocks high (default 1)"),
      },
    },
    async ({ item, count }) => action(deps, `pillar_up ${item}`, (s) => actions.pillarUp(item, count ?? 1, s))(),
  );

  server.registerTool(
    "craft",
    {
      description: "Craft an item by name (walks to a crafting table if the recipe needs one).",
      inputSchema: { item: z.string(), count: z.number().int().min(1).optional() },
    },
    async ({ item, count }) => action(deps, `craft ${item}`, (s) => actions.craft(item, count ?? 1, s))(),
  );

  server.registerTool(
    "equip",
    { description: "Hold an inventory item in the hand (tools, weapons, blocks). For wearing armor use equip_armor.", inputSchema: { item: z.string() } },
    async ({ item }) => {
      try {
        return ok(await actions.equip(item));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "equip_armor",
    {
      description:
        "Wear armor. Omit `item` to put on every armor piece in inventory; pass a name to wear one piece. Returns what is actually worn afterward.",
      inputSchema: { item: z.string().optional().describe("specific piece, e.g. 'netherite_helmet'; omit to wear all") },
    },
    async ({ item }) => {
      try {
        return ok(await actions.equipArmor(item));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "eat",
    {
      description:
        "Eat food to restore hunger so health can regenerate. Omit `item` to eat the best food you have. (Agents also auto-eat when hungry.)",
      inputSchema: { item: z.string().optional().describe("specific food, e.g. 'cooked_beef'; omit for best") },
    },
    async ({ item }) => action(deps, "eat", () => actions.eat(item))(),
  );

  server.registerTool(
    "drop_items",
    {
      description: "Drop items from inventory.",
      inputSchema: { item: z.string(), count: z.number().int().optional() },
    },
    async ({ item, count }) => {
      try {
        return ok(await actions.dropItems(item, count));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "inventory",
    { description: "List inventory contents.", inputSchema: {} },
    async () => ok(actions.inventory()),
  );

  server.registerTool(
    "list_chest",
    {
      description: "List the contents of a container (chest/barrel/...) at coordinates.",
      inputSchema: { x: z.number(), y: z.number(), z: z.number() },
    },
    async ({ x, y, z }) => action(deps, `list_chest (${x},${y},${z})`, (s) => actions.listChest(x, y, z, s))(),
  );

  server.registerTool(
    "deposit",
    {
      description: "Put items into a container at coordinates. Omit `item` to deposit everything.",
      inputSchema: {
        x: z.number(), y: z.number(), z: z.number(),
        item: z.string().optional(),
        count: z.number().int().min(1).optional(),
      },
    },
    async ({ x, y, z, item, count }) =>
      action(deps, `deposit ${item ?? "all"}`, (s) => actions.depositItems(x, y, z, item, count, s))(),
  );

  server.registerTool(
    "withdraw",
    {
      description: "Take items from a container at coordinates. Omit `count` to take all of that item.",
      inputSchema: {
        x: z.number(), y: z.number(), z: z.number(),
        item: z.string(),
        count: z.number().int().min(1).optional(),
      },
    },
    async ({ x, y, z, item, count }) =>
      action(deps, `withdraw ${item}`, (s) => actions.withdrawItems(x, y, z, item, count, s))(),
  );

  server.registerTool(
    "chat",
    {
      description: "Say something in Minecraft chat (also used to answer the player).",
      inputSchema: { message: z.string() },
    },
    async ({ message }) => {
      agent.say(message);
      return ok("sent");
    },
  );

  server.registerTool(
    "stop",
    {
      description: "Abort the bot's current action (navigation, collection, skill, ...). Always works, even when busy.",
      inputSchema: {},
    },
    async () => {
      const wasBusy = gate.busyWith;
      nav.stop();
      const stopped = gate.stop();
      return ok(stopped ? `aborted "${wasBusy}"` : "nothing was running");
    },
  );

  server.registerTool(
    "run_skill",
    {
      description:
        "Execute a skill file from skills/<name>.ts (must export `async function run(ctx: SkillContext)`). " +
        "Write or edit the skill file first, then call this. Errors return stack traces — fix the file and re-run. " +
        "See skills/TEMPLATE.ts for the contract and skills/lib/ for helpers.",
      inputSchema: {
        name: z.string().describe("skill file name without extension, e.g. 'pyramid' for skills/pyramid.ts"),
        args: z.record(z.unknown()).optional().describe("arguments passed to the skill as ctx.args"),
      },
    },
    async ({ name, args }) => {
      try {
        const result = await gate.run(`skill ${name}`, (signal) =>
          runSkill(
            name,
            { bot: agent.bot, nav, actions, creativeGive: cfg.dev.creativeGive },
            args ?? {},
            signal,
            (msg) => agent.say(msg),
          ),
        );
        return result.ok ? ok(String(result.output)) : fail(new Error(result.output));
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

/**
 * One streamable-HTTP MCP server hosting a route per agent at
 * http://127.0.0.1:<port>/mcp/<agentName> (stateless mode: a fresh
 * server+transport per request, each closing over that agent's live bot).
 * Each agent's codex app-server is pointed at its own route, so its tools only
 * ever act on its own bot.
 */
export function startMcpServer(agents: Map<string, McpDeps>, port: number): Promise<number> {
  const app = express();
  app.use(express.json());

  app.post("/mcp/:agent", async (req, res) => {
    const deps = agents.get(req.params.agent);
    if (!deps) {
      res.status(404).json({ error: `unknown agent "${req.params.agent}"` });
      return;
    }
    try {
      const server = buildServer(deps);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] request error:", err);
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  });

  // Stateless mode: no GET/DELETE session endpoints needed.
  app.get("/mcp/:agent", (_req, res) => res.status(405).end());
  app.delete("/mcp/:agent", (_req, res) => res.status(405).end());

  return new Promise((resolve) => {
    const listener = app.listen(port, "127.0.0.1", () => {
      const actual = (listener.address() as { port: number }).port;
      console.log(`[mcp] listening on http://127.0.0.1:${actual}/mcp/<agent> for: ${[...agents.keys()].join(", ")}`);
      resolve(actual);
    });
  });
}
