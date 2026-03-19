import type { MonitorPlugin, MonitorInstance, ChunkParser, BuiltinParserName } from '../core/types';
import { uid } from '../core/utils';
import { resolveParser } from '../parsers/index';
import { StreamParserDriver } from '../core/stream-parser-driver';

export interface SSEAutoPluginOptions {
  /** 只追踪匹配的 URL（必须配置，否则不追踪任何连接） */
  includeUrls?: RegExp[];
  /** 排除匹配的 URL（优先级高于 includeUrls） */
  excludeUrls?: RegExp[];
  /** 流式内容解析器，配置后自动解析 event.data 驱动 trace 生命周期 */
  parser?: BuiltinParserName | ChunkParser;
}

/**
 * EventSource 自动追踪插件。
 * 监听通过原生 EventSource 建立的 SSE 连接，自动追踪生命周期。
 *
 * 注意：大多数 AI 对话项目使用 fetch + ReadableStream 而非 EventSource。
 * 此插件仅处理原生 EventSource 场景。
 */
export class SSEAutoPlugin implements MonitorPlugin {
  readonly name = 'sse-auto';
  readonly priority = 50;

  private options: SSEAutoPluginOptions;
  private originalEventSource: typeof EventSource | null = null;
  private resolvedParser: ChunkParser | null = null;

  constructor(options: SSEAutoPluginOptions = {}) {
    this.options = options;
  }

  setup(monitor: MonitorInstance): void {
    if (typeof EventSource === 'undefined') return;

    if (this.options.parser) {
      this.resolvedParser = resolveParser(this.options.parser);
    }

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

      const parser = self.resolvedParser;
      const trace = mon.createStreamTrace({ messageId: uid() });
      const driver = parser ? new StreamParserDriver(parser, trace) : null;

      trace.start();

      let firstChunkReceived = false;

      const handleMessage = (event: MessageEvent) => {
        if (driver?.isEnded) return;

        if (!firstChunkReceived) {
          firstChunkReceived = true;
          trace.onFirstChunk();
        }

        const data = typeof event.data === 'string' ? event.data : '';

        if (data === '[DONE]') {
          if (driver) {
            driver.finalize();
          } else {
            trace.complete();
          }
          return;
        }

        driver?.feed(`data: ${data}`);
      };

      const origAddEventListener = es.addEventListener.bind(es);
      es.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
        if (type === 'message' && typeof listener === 'function') {
          const wrappedListener = (event: Event) => {
            handleMessage(event as MessageEvent);
            (listener as EventListener)(event);
          };
          return origAddEventListener(type, wrappedListener, options);
        }
        return origAddEventListener(type, listener, options);
      } as typeof es.addEventListener;

      let userOnMessage: ((event: MessageEvent) => void) | null = null;
      Object.defineProperty(es, 'onmessage', {
        set(fn: ((event: MessageEvent) => void) | null) {
          userOnMessage = fn;
        },
        get() {
          return userOnMessage;
        },
      });

      origAddEventListener('message', (event: Event) => {
        handleMessage(event as MessageEvent);
        userOnMessage?.(event as MessageEvent);
      });

      origAddEventListener('error', () => {
        if (!driver?.isEnded) {
          trace.error('EventSource error');
        }
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
    return false;
  }
}
