import type { MonitorPlugin, MonitorInstance, ChunkParser, BuiltinParserName } from '../core/types';
import { resolveParser } from '../parsers/index';

export interface SSEAutoPluginOptions {
  /** 只追踪匹配的 URL，不传则追踪所有 EventSource 连接 */
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
 * 相比旧版修复了以下问题：
 * - 同时拦截 onmessage setter 和 addEventListener('message', ...) 两种注册方式
 * - 配置 parser 后会解析 event.data，自动驱动 thinking/tool call/token 检测
 * - 检测 [DONE] 消息和 error 事件触发 trace.complete()
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
      parser?.reset();

      const trace = mon.createStreamTrace({
        messageId: `es_${Date.now().toString(36)}`,
      });

      trace.start();

      let firstChunkReceived = false;
      let isInThinking = false;
      let hasContentStarted = false;
      let traceEnded = false;

      const handleMessage = (event: MessageEvent) => {
        if (traceEnded) return;

        if (!firstChunkReceived) {
          firstChunkReceived = true;
          trace.onFirstChunk();
        }

        const data = typeof event.data === 'string' ? event.data : '';

        if (data === '[DONE]') {
          if (isInThinking) trace.onPhase('thinking', 'end');
          if (hasContentStarted) trace.onPhase('generating', 'end');
          traceEnded = true;
          trace.complete();
          return;
        }

        if (!parser) return;

        const chunk = parser.parse(`data: ${data}`);
        if (!chunk) return;

        if (chunk.thinking && !isInThinking) {
          isInThinking = true;
          trace.onPhase('thinking', 'start');
        }
        if (isInThinking && chunk.content && !chunk.thinking) {
          isInThinking = false;
          trace.onPhase('thinking', 'end');
        }
        if (chunk.content && !hasContentStarted) {
          hasContentStarted = true;
          if (!isInThinking) trace.onPhase('generating', 'start');
        }
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            trace.onToolCall(tc.name, tc.arguments);
          }
        }
        if (chunk.done) {
          if (isInThinking) trace.onPhase('thinking', 'end');
          if (hasContentStarted) trace.onPhase('generating', 'end');
          traceEnded = true;
          const result: Record<string, unknown> = {};
          if (chunk.tokenUsage) {
            if (chunk.tokenUsage.promptTokens != null) result.promptTokens = chunk.tokenUsage.promptTokens;
            if (chunk.tokenUsage.completionTokens != null) result.completionTokens = chunk.tokenUsage.completionTokens;
            if (chunk.tokenUsage.totalTokens != null) result.totalTokens = chunk.tokenUsage.totalTokens;
          }
          trace.complete(result);
        }
      };

      // 拦截 addEventListener 以捕获 message 事件
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

      // 拦截 onmessage setter
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

      // 错误处理
      origAddEventListener('error', () => {
        if (!traceEnded) {
          traceEnded = true;
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
    return true;
  }
}
