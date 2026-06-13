import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  minecraft: z.object({
    host: z.string(),
    port: z.number().int(),
    version: z.string(),
    username: z.string(),
    auth: z.enum(["offline", "microsoft"]),
  }),
  chat: z.object({
    mention: z.string(),
    /** Empty list = anyone may command the bot (dev only). */
    whitelist: z.array(z.string()),
    maxChatLineLength: z.number().int().positive(),
  }),
  mcp: z.object({
    port: z.number().int(),
  }),
  codex: z.object({
    command: z.string(),
    model: z.string().nullable(),
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]),
  }),
  dev: z.object({
    /** If true, skills may /give themselves materials (creative/dev servers). */
    creativeGive: z.boolean(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(file = path.join(repoRoot, "config.json")): Config {
  const cfg = ConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  // Env overrides for volatile fields — handy for LAN worlds (Open to LAN
  // picks a new random port every launch):
  //   MINEAGENT_PORT, MINEAGENT_HOST, MINEAGENT_VERSION, MINEAGENT_USERNAME
  if (process.env.MINEAGENT_PORT) cfg.minecraft.port = Number(process.env.MINEAGENT_PORT);
  if (process.env.MINEAGENT_HOST) cfg.minecraft.host = process.env.MINEAGENT_HOST;
  if (process.env.MINEAGENT_VERSION) cfg.minecraft.version = process.env.MINEAGENT_VERSION;
  if (process.env.MINEAGENT_USERNAME) cfg.minecraft.username = process.env.MINEAGENT_USERNAME;

  return cfg;
}
