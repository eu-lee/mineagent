import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Bot } from "mineflayer";
import type { Navigator } from "../bot/navigator.js";
import type { Actions } from "../bot/actions.js";
import { repoRoot } from "../config.js";

/** API surface handed to generated skills. Documented in skills/TEMPLATE.ts. */
export interface SkillContext {
  bot: Bot;
  nav: Navigator;
  actions: Actions;
  /** Cooperative cancellation — long loops must check/pass this. */
  signal: AbortSignal;
  /** Progress messages: logged and surfaced to the requesting player. */
  log: (msg: string) => void;
  /** Arguments passed by the LLM to run_skill. */
  args: Record<string, unknown>;
  /** Dev convenience: when true, builders may `/give` missing materials. */
  creativeGive: boolean;
}

export type SkillModule = {
  run: (ctx: SkillContext) => Promise<string | void>;
};

const SKILLS_DIR = path.join(repoRoot, "skills");
/** Where agents write their own skills (kept out of the curated skills/ root). */
const GENERATED_DIR = path.join(SKILLS_DIR, "generated");
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface SkillRunResult {
  ok: boolean;
  output: string;
}

/**
 * Hot-loads and executes a skill file. Cache-busted dynamic import so Codex
 * can edit a skill and immediately re-run it. Errors come back with stack
 * traces so the LLM can self-debug.
 */
export async function runSkill(
  name: string,
  ctx: Omit<SkillContext, "log" | "args" | "signal">,
  args: Record<string, unknown>,
  signal: AbortSignal,
  log: (msg: string) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SkillRunResult> {
  const safe = /^[\w-]+$/.test(name);
  if (!safe) return { ok: false, output: `invalid skill name "${name}" (use [a-zA-Z0-9_-])` };

  // Prefer the agent-writable generated/ folder; fall back to curated skills/.
  const genFile = path.join(GENERATED_DIR, `${name}.ts`);
  const rootFile = path.join(SKILLS_DIR, `${name}.ts`);
  const file = existsSync(genFile) ? genFile : rootFile;
  if (!existsSync(file)) {
    return { ok: false, output: `skill file not found: skills/generated/${name}.ts` };
  }

  let mod: SkillModule;
  try {
    // Cache-bust so edits are picked up (tsx compiles TS imports on the fly).
    mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as SkillModule;
  } catch (err) {
    return { ok: false, output: `skill failed to load:\n${errDetail(err)}` };
  }
  if (typeof mod.run !== "function") {
    return { ok: false, output: `skills/${name}.ts must export: async function run(ctx: SkillContext)` };
  }

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`skill timed out after ${timeoutMs / 1000}s`)), timeoutMs),
  );
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(new Error("skill aborted"));
    signal.addEventListener("abort", () => reject(new Error("skill aborted")), { once: true });
  });

  try {
    const result = await Promise.race([mod.run({ ...ctx, signal, log, args }), timeout, aborted]);
    return { ok: true, output: result ?? `skill ${name} completed` };
  } catch (err) {
    return { ok: false, output: `skill ${name} failed:\n${errDetail(err)}` };
  } finally {
    // Whatever happened, make sure the bot isn't left walking somewhere.
    ctx.nav.stop();
  }
}

function errDetail(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}
