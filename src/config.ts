import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  minecraft: z.object({
    host: z.string(),
    port: z.number().int(),
    version: z.string(),
    auth: z.enum(["offline", "microsoft"]),
  }),
  agents: z.object({
    /** Number of identical clones to spawn, named Agent1..AgentN. */
    count: z.number().int().positive(),
    /** Optional in-game name prefix (default "Agent" → Agent1, Agent2, ...). */
    namePrefix: z.string().optional(),
    /** Shared personality/instructions seeded into every agent's brain. */
    personality: z.string(),
    /** Model for the agents (null = codex CLI default). */
    model: z.string().nullable(),
  }),
  chat: z.object({
    /** Empty list = anyone may command the bots (dev only). */
    whitelist: z.array(z.string()),
    maxChatLineLength: z.number().int().positive(),
  }),
  mcp: z.object({
    port: z.number().int(),
  }),
  codex: z.object({
    command: z.string(),
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]),
  }),
  dev: z.object({
    /** If true, skills may /give themselves materials (creative/dev servers). */
    creativeGive: z.boolean(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Generated agent names: <prefix>1 .. <prefix>N (prefix defaults to "Agent"). */
export function agentNames(cfg: Config): string[] {
  const prefix = cfg.agents.namePrefix ?? "Agent";
  return Array.from({ length: cfg.agents.count }, (_, i) => `${prefix}${i + 1}`);
}

export function loadConfig(file = path.join(repoRoot, "config.json")): Config {
  const cfg = ConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  // Env overrides for volatile fields — handy for LAN worlds (Open to LAN
  // picks a new random port every launch):
  //   MINEAGENT_PORT, MINEAGENT_HOST, MINEAGENT_VERSION
  if (process.env.MINEAGENT_PORT) cfg.minecraft.port = Number(process.env.MINEAGENT_PORT);
  if (process.env.MINEAGENT_HOST) cfg.minecraft.host = process.env.MINEAGENT_HOST;
  if (process.env.MINEAGENT_VERSION) cfg.minecraft.version = process.env.MINEAGENT_VERSION;

  return cfg;
}
