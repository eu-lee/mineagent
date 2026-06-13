import { describe, expect, it } from "vitest";
import { ActionGate } from "./action-gate.js";

describe("ActionGate", () => {
  it("runs one action and clears busy state", async () => {
    const gate = new ActionGate();
    expect(gate.busyWith).toBeNull();
    const result = await gate.run("walk", async () => {
      expect(gate.busyWith).toBe("walk");
      return "done";
    });
    expect(result).toBe("done");
    expect(gate.busyWith).toBeNull();
  });

  it("rejects concurrent actions", async () => {
    const gate = new ActionGate();
    let release!: () => void;
    const first = gate.run("dig", () => new Promise<void>((r) => (release = r)));
    await expect(gate.run("walk", async () => {})).rejects.toThrow(/already busy with "dig"/);
    release();
    await first;
    await gate.run("walk", async () => {}); // works after first completes
  });

  it("stop aborts the running action's signal", async () => {
    const gate = new ActionGate();
    const run = gate.run("collect", (signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    expect(gate.stop()).toBe(true);
    await expect(run).rejects.toThrow("aborted");
    expect(gate.busyWith).toBeNull();
    expect(gate.stop()).toBe(false);
  });

  it("clears busy state when the action throws", async () => {
    const gate = new ActionGate();
    await expect(gate.run("craft", async () => {
      throw new Error("no materials");
    })).rejects.toThrow("no materials");
    expect(gate.busyWith).toBeNull();
  });
});
