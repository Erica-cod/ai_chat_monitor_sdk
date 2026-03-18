import type { MonitorPlugin, MonitorInstance } from '../core/types';

/**
 * SSE 追踪插件（自动模式）。
 * 监听通过 EventSource 建立的 SSE 连接，自动追踪生命周期。
 *
 * 注意：大多数 AI 对话项目使用 fetch + ReadableStream 而非 EventSource。
 * 对于 fetch-based SSE，推荐使用 monitor.createSSETrace() 手动追踪。
 * 此插件仅处理原生 EventSource 场景。
 */
export class SSEAutoPlugin implements MonitorPlugin {
  readonly name = 'sse-auto';
  readonly priority = 50;

  private originalEventSource: typeof EventSource | null = null;

  setup(monitor: MonitorInstance): void {
    if (typeof EventSource === 'undefined') return;

    this.originalEventSource = EventSource;
    const OrigES = EventSource;
    const mon = monitor;

    const PatchedEventSource = function (
      this: EventSource,
      url: string | URL,
      init?: EventSourceInit,
    ) {
      const es = new OrigES(url, init);
      const trace = mon.createSSETrace({
        messageId: `es_${Date.now().toString(36)}`,
      });

      trace.start();

      let firstChunkReceived = false;
      const origOnMessage = es.onmessage;
      Object.defineProperty(es, 'onmessage', {
        set(fn) {
          origOnMessage; // 保留引用
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
}
