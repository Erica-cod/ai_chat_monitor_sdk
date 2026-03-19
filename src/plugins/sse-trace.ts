import type { MonitorPlugin, MonitorInstance } from '../core/types';

export interface SSEAutoPluginOptions {
  /** 只追踪匹配的 URL，不传则追踪所有 EventSource 连接 */
  includeUrls?: RegExp[];
  /** 排除匹配的 URL（优先级高于 includeUrls） */
  excludeUrls?: RegExp[];
}

/**
 * EventSource 自动追踪插件。
 * 监听通过原生 EventSource 建立的 SSE 连接，自动追踪生命周期。
 *
 * ⚠️ 此插件会替换全局 EventSource 构造函数，可能影响第三方库。
 * 建议通过 includeUrls 限定追踪范围。
 *
 * 注意：大多数 AI 对话项目使用 fetch + ReadableStream 而非 EventSource。
 * 对于 fetch-based 流式响应，推荐配置 FetchPlugin 的 streamPatterns 实现自动追踪，
 * 或使用 monitor.createStreamTrace() 手动追踪。
 * 此插件仅处理原生 EventSource 场景。
 */
export class SSEAutoPlugin implements MonitorPlugin {
  readonly name = 'sse-auto';
  readonly priority = 50;

  private options: SSEAutoPluginOptions;
  private originalEventSource: typeof EventSource | null = null;

  constructor(options: SSEAutoPluginOptions = {}) {
    this.options = options;
  }

  setup(monitor: MonitorInstance): void {
    if (typeof EventSource === 'undefined') return;

    this.originalEventSource = EventSource;
    const OrigES = EventSource;
    const mon = monitor;
    const self = this;

    const PatchedEventSource = function (
      this: EventSource,
      url: string | URL,
      init?: EventSourceInit,
    ) {
      const es = new OrigES(url, init);

      const urlStr = typeof url === 'string' ? url : url.toString();
      if (!self.shouldTrace(urlStr)) return es;

      const trace = mon.createStreamTrace({
        messageId: `es_${Date.now().toString(36)}`,
      });

      trace.start();

      let firstChunkReceived = false;
      const origOnMessage = es.onmessage;
      Object.defineProperty(es, 'onmessage', {
        set(fn) {
          origOnMessage;
          es.addEventListener('message', (event: MessageEvent) => {
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              trace.onFirstChunk();
            }
            fn?.(event);
          });
        },
        get() {
          return origOnMessage;
        },
      });

      es.addEventListener('error', () => {
        trace.error('EventSource error');
      });

      return es;
    } as unknown as typeof EventSource;

    Object.setPrototypeOf(PatchedEventSource, OrigES);
    Object.setPrototypeOf(PatchedEventSource.prototype, OrigES.prototype);

    (globalThis as Record<string, unknown>).EventSource = PatchedEventSource;
  }

  teardown(): void {
    if (this.originalEventSource) {
      (globalThis as Record<string, unknown>).EventSource = this.originalEventSource;
    }
  }

  private shouldTrace(url: string): boolean {
    if (this.options.excludeUrls?.some((re) => re.test(url))) return false;
    if (this.options.includeUrls && this.options.includeUrls.length > 0) {
      return this.options.includeUrls.some((re) => re.test(url));
    }
    return true;
  }
}
