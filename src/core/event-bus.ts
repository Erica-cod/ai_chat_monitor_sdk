type Handler = (...args: unknown[]) => void;

/**
 * 轻量级发布-订阅事件总线。
 * 用于 SDK 内部模块间通信，不暴露给最终用户。
 */
export class EventBus {
  private listeners = new Map<string, Set<Handler>>();
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  on(event: string, handler: Handler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch (err) {
        if (this.debug) {
          console.warn(`[ai-stream-monitor] EventBus handler error on "${event}":`, err);
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
