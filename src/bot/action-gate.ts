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
}
