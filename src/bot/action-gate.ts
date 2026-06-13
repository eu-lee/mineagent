/**
 * Serializes physical bot actions: only one at a time, each cancellable.
 * `stop()` aborts whatever is running (used by the MCP `stop` tool and the
 * in-chat "@agent stop" fast path).
 */
export class ActionGate {
  private current: { name: string; controller: AbortController } | null = null;

  get busyWith(): string | null {
    return this.current?.name ?? null;
  }

  async run<T>(name: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.current) {
      throw new Error(`already busy with "${this.current.name}" — call stop first or wait`);
    }
    const controller = new AbortController();
    this.current = { name, controller };
    try {
      return await fn(controller.signal);
    } finally {
      this.current = null;
    }
  }

  stop(): boolean {
    if (!this.current) return false;
    this.current.controller.abort();
    return true;
  }

  /**
   * Abort whatever is running and take over with `fn` (used by survival reflexes
   * that must react immediately). Waits for the aborted action to settle so we
   * don't hit the "already busy" guard.
   */
  async preempt<T>(name: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.current) this.current.controller.abort();
    for (let i = 0; this.current && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20)); // let the aborted action's finally clear it
    }
    return this.run(name, fn);
  }
}
