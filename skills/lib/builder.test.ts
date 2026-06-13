import { describe, expect, it } from "vitest";
import { pyramidPlacements } from "./builder.js";

describe("pyramidPlacements", () => {
  it("builds the expected layer counts for a 5-wide pyramid", () => {
    const p = pyramidPlacements(0, 64, 0, 5, "stone");
    // layers: 5x5 + 3x3 + 1x1 = 25 + 9 + 1
    expect(p).toHaveLength(35);
    expect(p.filter((b) => b.pos.y === 64)).toHaveLength(25);
    expect(p.filter((b) => b.pos.y === 65)).toHaveLength(9);
    expect(p.filter((b) => b.pos.y === 66)).toHaveLength(1);
  });

  it("centers the apex over the base center", () => {
    const p = pyramidPlacements(10, 64, -20, 7, "stone");
    const apex = p.filter((b) => b.pos.y === 67);
    expect(apex).toHaveLength(1);
    expect(apex[0].pos.x).toBe(10);
    expect(apex[0].pos.z).toBe(-20);
    expect(p.every((b) => b.block === "stone")).toBe(true);
  });
});
