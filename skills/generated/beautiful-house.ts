import { Vec3 } from "vec3";
import type { SkillContext } from "../../src/skills/runtime.js";
import { buildStructure, hollowBox, platform, pyramidPlacements } from "../lib/builder.js";

export async function run(ctx: SkillContext): Promise<string> {
  const p = ctx.bot.entity.position.floored();
  const cx = Number(ctx.args.x ?? p.x + 2);
  const baseY = Number(ctx.args.y ?? p.y);
  const cz = Number(ctx.args.z ?? p.z + 2);

  ctx.log(`building a large manor at (${cx}, ${baseY}, ${cz})`);

  const mainX1 = cx - 8;
  const mainX2 = cx + 8;
  const mainZ1 = cz - 6;
  const mainZ2 = cz + 6;

  const porchX1 = cx - 3;
  const porchX2 = cx + 3;
  const porchZ1 = mainZ2 + 1;
  const porchZ2 = mainZ2 + 7;

  const placements = [
    // Main foundation and shell.
    ...platform(new Vec3(mainX1, baseY, mainZ1), 17, 13, "cobblestone"),
    ...hollowBox(
      new Vec3(mainX1, baseY + 1, mainZ1),
      new Vec3(mainX2, baseY + 5, mainZ2),
      "oak_planks",
      { floor: false, ceiling: false },
    ),

    // Main structural columns.
    ...vertical(mainX1, baseY + 1, mainZ1, 5, "oak_log"),
    ...vertical(mainX2, baseY + 1, mainZ1, 5, "oak_log"),
    ...vertical(mainX1, baseY + 1, mainZ2, 5, "oak_log"),
    ...vertical(mainX2, baseY + 1, mainZ2, 5, "oak_log"),
    ...vertical(cx, baseY + 1, mainZ1, 5, "cobbled_deepslate"),
    ...vertical(cx, baseY + 1, mainZ2, 5, "cobbled_deepslate"),
    ...vertical(mainX1, baseY + 1, cz, 5, "cobbled_deepslate"),
    ...vertical(mainX2, baseY + 1, cz, 5, "cobbled_deepslate"),

    // Front entrance and porch.
    { pos: new Vec3(cx, baseY + 1, mainZ2), block: "oak_door" },
    { pos: new Vec3(cx, baseY + 2, mainZ2), block: "oak_door" },
    ...platform(new Vec3(porchX1, baseY, porchZ1), 7, 7, "cobblestone"),
    ...vertical(porchX1, baseY + 1, porchZ1, 4, "oak_log"),
    ...vertical(porchX2, baseY + 1, porchZ1, 4, "oak_log"),
    ...vertical(porchX1, baseY + 1, porchZ2, 4, "oak_log"),
    ...vertical(porchX2, baseY + 1, porchZ2, 4, "oak_log"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1), 7, 1, "oak_wood"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1 + 1), 7, 1, "oak_wood"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1 + 2), 7, 1, "oak_wood"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1 + 3), 7, 1, "oak_wood"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1 + 4), 7, 1, "oak_wood"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1 + 5), 7, 1, "oak_wood"),
    ...platform(new Vec3(porchX1, baseY + 4, porchZ1 + 6), 7, 1, "oak_wood"),

    // Window bands on the main house.
    ...windowBand(mainX1, mainX2, baseY + 2, mainZ1, "glass"),
    ...windowBand(mainX1, mainX2, baseY + 3, mainZ1, "glass"),
    ...windowBand(mainX1, mainX2, baseY + 2, mainZ2, "glass"),
    ...windowBand(mainX1, mainX2, baseY + 3, mainZ2, "glass"),
    ...sideWindows(mainZ1, mainZ2, mainX1, baseY + 2, "glass"),
    ...sideWindows(mainZ1, mainZ2, mainX2, baseY + 2, "glass"),

    // Roofs.
    ...pyramidPlacements(cx, baseY + 6, cz, 17, "oak_wood", { hollow: true }),
    ...pyramidPlacements(cx, baseY + 5, porchZ1 + 3, 7, "oak_wood", { hollow: true }),

    // Chimneys and trim.
    ...vertical(mainX2 - 1, baseY + 6, mainZ1 + 1, 4, "cobbled_deepslate"),
    ...vertical(mainX2 - 1, baseY + 7, mainZ1 + 1, 1, "cobbled_deepslate"),
  ];

  const summary = await buildStructure(ctx, placements);
  return `manor done: ${summary}`;
}

function vertical(x: number, y: number, z: number, height: number, block: string) {
  const out: { pos: Vec3; block: string }[] = [];
  for (let i = 0; i < height; i++) out.push({ pos: new Vec3(x, y + i, z), block });
  return out;
}

function windowBand(x1: number, x2: number, y: number, z: number, block: string) {
  const out: { pos: Vec3; block: string }[] = [];
  for (let x = x1 + 2; x <= x2 - 2; x += 3) out.push({ pos: new Vec3(x, y, z), block });
  return out;
}

function sideWindows(z1: number, z2: number, x: number, y: number, block: string) {
  const out: { pos: Vec3; block: string }[] = [];
  for (let z = z1 + 2; z <= z2 - 2; z += 3) out.push({ pos: new Vec3(x, y, z), block });
  return out;
}
