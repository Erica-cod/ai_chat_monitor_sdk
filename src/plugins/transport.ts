import type { MonitorPlugin, MonitorInstance, MonitorEvent } from '../core/types';
import { isBrowser } from '../core/utils';

export interface TransportPluginOptions {
  /** 上报地址（默认取 monitor.config.endpoint） */
  endpoint?: string;
  /** 上报模式：即时 / 批量 */
  mode?: 'immediate' | 'batch';
  /** 批量上报：缓冲区大小，默认 10 */
  batchSize?: number;
  /** 批量上报：刷新间隔（毫秒），默认 5000 */
  flushInterval?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 自定义请求头（认证 token、correlation ID 等），仅对 fetch 方式生效 */
  headers?: Record<string, string>;
  /** 自定义上报函数，传入后跳过内置的 sendBeacon/fetch */
  customSend?: (endpoint: string, payload: string) => void;
}

/**
 * 传输插件。
 * 支持三种上报方式（按优先级）：customSend → sendBeacon → fetch。
 * 支持即时上报和批量上报两种模式。
 */
export class TransportPlugin implements MonitorPlugin {
  readonly name = 'transport';
  readonly priority = 90;

  private options: TransportPluginOptions;
  private endpoint = '/api/monitor';
  private buffer: MonitorEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private onBeforeUnload: (() => void) | null = null;
  private onVisibilityChange: (() => void) | null = null;
  private monitor: MonitorInstance | null = null;

  constructor(options: TransportPluginOptions = {}) {
    this.options = {
      mode: 'batch',
      batchSize: 10,
      flushInterval: 5000,
      maxRetries: 3,
      ...options,
    };
  }

  setup(monitor: MonitorInstance): void {
    this.monitor = monitor;
    this.endpoint = this.options.endpoint ?? monitor.config.endpoint;

    monitor.on('event', (event: unknown) => {
      this.enqueue(event as MonitorEvent);
    });

    monitor.on('transport:send', (events: unknown) => {
      this.sendBatch(events as MonitorEvent[]);
    });

    if (this.options.mode === 'batch') {
      this.timer = setInterval(() => this.flush(), this.options.flushInterval!);

      if (isBrowser()) {
        this.onBeforeUnload = () => this.flush();
        this.onVisibilityChange = () => {
          if (document.visibilityState === 'hidden') this.flush();
        };
        window.addEventListener('beforeunload', this.onBeforeUnload);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
      }
    }
  }

  teardown(): void {
    this.flush();
    if (this.timer !== null) clearInterval(this.timer);
    if (isBrowser()) {
      if (this.onBeforeUnload) {
        window.removeEventListener('beforeunload', this.onBeforeUnload);
      }
      if (this.onVisibilityChange) {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
      }
    }
  }

  private enqueue(event: MonitorEvent): void {
    if (this.options.mode === 'immediate') {
      this.sendBatch([event]);
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length >= this.options.batchSize!) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.sendBatch(batch);
  }

  private sendBatch(events: MonitorEvent[]): void {
    if (events.length === 0) return;
    const payload = JSON.stringify(events);

    if (this.options.customSend) {
      try {
        this.options.customSend(this.endpoint, payload);
      } catch {
        // 自定义发送失败时 fallback 到内置方式
        this.sendViaBuiltin(payload);
      }
      return;
    }

    this.sendViaBuiltin(payload);
  }

  private sendViaBuiltin(payload: string): void {
    const hasCustomHeaders = this.options.headers && Object.keys(this.options.headers).length > 0;
    if (!hasCustomHeaders && this.sendViaBeacon(payload)) return;
    this.sendViaFetch(payload);
  }

  /** sendBeacon 有约 64KB 限制，大负载直接跳过 */
  private sendViaBeacon(payload: string): boolean {
    if (!isBrowser() || typeof navigator.sendBeacon !== 'function') return false;
    if (payload.length > 60_000) return false;
    try {
      return navigator.sendBeacon(
        this.endpoint,
        new Blob([payload], { type: 'application/json' }),
      );
    } catch {
      return false;
    }
  }

  private sendViaFetch(payload: string, retries = 0): void {
    if (typeof fetch === 'undefined') return;

    fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.options.headers },
      body: payload,
      keepalive: true,
    }).catch(() => {
      if (retries < this.options.maxRetries!) {
        const delay = Math.min(1000 * 2 ** retries, 30_000);
        setTimeout(() => this.sendViaFetch(payload, retries + 1), delay);
      } else {
        this.emitFailed(payload);
      }
    });
  }

  private emitFailed(payload: string): void {
    if (!this.monitor) return;
    try {
      const events = JSON.parse(payload) as MonitorEvent[];
      this.monitor.signal('transport:failed', events);
    } catch {
      // 静默
    }
  }
}
