import type { SkillContext } from "../../src/skills/runtime.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cmd(bot: SkillContext["bot"], message: string): void {
  bot.chat(message);
}

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 8);
  const baseY = Number(ctx.args.y ?? p.y - 1);
  const cz = Number(ctx.args.z ?? p.z + 8);

  ctx.log(`building a fox face at (${cx}, ${baseY}, ${cz})`);

  const x1 = cx - 3;
  const x2 = cx + 3;
  const z1 = cz - 3;
  const z2 = cz + 3;

  const commands = [
    `/fill ${x1} ${baseY} ${z1} ${x2} ${baseY} ${z2} stone_bricks`,
    `/fill ${cx - 2} ${baseY + 1} ${cz - 2} ${cx + 2} ${baseY + 3} ${cz + 2} orange_wool`,
    `/fill ${cx - 1} ${baseY + 1} ${cz + 1} ${cx + 1} ${baseY + 2} ${cz + 2} white_wool`,
    `/fill ${cx - 1} ${baseY + 4} ${cz - 2} ${cx - 1} ${baseY + 5} ${cz - 2} orange_wool`,
    `/fill ${cx + 1} ${baseY + 4} ${cz - 2} ${cx + 1} ${baseY + 5} ${cz - 2} orange_wool`,
    `/fill ${cx - 1} ${baseY + 6} ${cz - 2} ${cx - 1} ${baseY + 6} ${cz - 2} black_wool`,
    `/fill ${cx + 1} ${baseY + 6} ${cz - 2} ${cx + 1} ${baseY + 6} ${cz - 2} black_wool`,
    `/setblock ${cx - 1} ${baseY + 2} ${cz - 2} black_wool`,
    `/setblock ${cx + 1} ${baseY + 2} ${cz - 2} black_wool`,
    `/setblock ${cx} ${baseY + 1} ${cz - 2} black_wool`,
    `/fill ${cx - 4} ${baseY + 2} ${cz + 2} ${cx - 2} ${baseY + 3} ${cz + 3} orange_wool`,
    `/fill ${cx - 5} ${baseY + 3} ${cz + 3} ${cx - 4} ${baseY + 4} ${cz + 3} white_wool`,
  ];

  for (const message of commands) {
    if (ctx.signal.aborted) throw new Error("build aborted");
    cmd(ctx.bot, message);
    await sleep(250);
  }

  return `fox face built at (${cx}, ${baseY}, ${cz}) with ${commands.length} commands`;
}
