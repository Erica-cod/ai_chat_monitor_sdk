import type { MonitorPlugin, MonitorInstance, MonitorEvent } from '../core/types';

export interface DedupePluginOptions {
  /** 去重时间窗口（毫秒），默认 5000 */
  windowMs?: number;
}

/**
 * 事件去重插件。
 * 在指定时间窗口内，相同 type + 相同关键 data 的事件只上报一次。
 * 避免短时间内重复触发（如连续的相同错误）。
 */
export class DedupePlugin implements MonitorPlugin {
  readonly name = 'dedupe';
  readonly priority = 20;

  private windowMs: number;
  private recent = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: DedupePluginOptions = {}) {
    this.windowMs = options.windowMs ?? 5000;
  }

  setup(monitor: MonitorInstance): void {
    const monitorAny = monitor as { emit: (event: MonitorEvent) => void };
    const originalEmit = monitorAny.emit.bind(monitor);

    monitorAny.emit = (event: MonitorEvent) => {
      const key = this.eventKey(event);
      const lastSeen = this.recent.get(key);
      const now = Date.now();

      if (lastSeen && now - lastSeen < this.windowMs) {
        return; // 去重：跳过
      }

      this.recent.set(key, now);
      originalEmit(event);
    };

    this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs * 2);
  }

  teardown(): void {
    if (this.cleanupTimer !== null) clearInterval(this.cleanupTimer);
    this.recent.clear();
  }

  private eventKey(event: MonitorEvent): string {
    const { type, data } = event;
    const sig =
      type === 'js_error' || type === 'promise_error'
        ? String(data.message ?? '')
        : type === 'resource_error'
          ? String(data.src ?? '')
          : type === 'http_request'
            ? `${data.method}:${data.url}`
            : type;
    return `${type}::${sig}`;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, time] of this.recent) {
      if (time < cutoff) this.recent.delete(key);
    }
  }
}
