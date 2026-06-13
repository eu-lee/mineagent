/**
 * SKILL TEMPLATE — copy this file to skills/<skill-name>.ts and implement run().
 *
 * Contract:
 *  - Export `async function run(ctx: SkillContext): Promise<string | void>`
 *  - Return a short summary string on success; throw on failure.
 *  - Check `ctx.signal.aborted` in loops and pass `ctx.signal` to every
 *    action/navigation call so "@agent stop" works.
 *  - Use `ctx.log("...")` for progress the player should see.
 *
 * Available on ctx:
 *  - ctx.actions  — high-level primitives (goto, dig, place, collect, craft...)
 *  - ctx.nav      — Navigator: nav.goto(vec3, range, signal)
 *  - ctx.bot      — raw mineflayer Bot (escape hatch; prefer ctx.actions)
 *  - ctx.args     — arguments passed via run_skill, e.g. { size: 7 }
 *
 * Helpers in skills/lib/ (import with relative paths):
 *  - lib/builder.ts:
 *      buildStructure(ctx, placements) — places { pos: Vec3, block }[] bottom-up,
 *        ordering/navigating for you and topping up materials (ctx.creativeGive).
 *      Shape generators (compose, then pass to buildStructure):
 *        cuboid(c1,c2,block)               filled box
 *        hollowBox(c1,c2,block,{floor,ceiling})  shell / room
 *        platform(corner,w,l,block)        flat slab
 *        wall(from,to,height,block)        straight wall
 *        cylinder(center,r,h,block,{hollow})
 *        sphere(center,r,block,{hollow}) / dome(center,r,block)
 *        pyramidPlacements(cx,baseY,cz,size,block,{hollow})
 *        line(from,to,block)
 *    Build on the ground/with support — fully floating shapes can't be placed.
 */
import type { SkillContext } from "../src/skills/runtime.js";

export async function run(ctx: SkillContext): Promise<string> {
  ctx.log("template skill: doing nothing");
  return "template completed";
}
