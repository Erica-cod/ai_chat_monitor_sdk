import type { MonitorPlugin, MonitorInstance, ChunkParser, BuiltinParserName } from '../core/types';
import { resolveParser } from '../parsers/index';

export interface WebSocketPluginOptions {
  /** 只追踪匹配的 URL */
  includeUrls?: RegExp[];
  /** 排除匹配的 URL（优先级高于 includeUrls） */
  excludeUrls?: RegExp[];
  /** 流式内容解析器，配置后自动解析 message.data 驱动 trace 生命周期 */
  parser?: BuiltinParserName | ChunkParser;
}

/**
 * WebSocket 自动追踪插件。
 * Patch 全局 WebSocket 构造函数，对匹配 URL 的连接自动创建 StreamTrace。
 *
 * ⚠️ 此插件会替换全局 WebSocket 构造函数，建议通过 includeUrls 限定范围。
 */
export class WebSocketPlugin implements MonitorPlugin {
  readonly name = 'websocket';
  readonly priority = 50;

  private options: WebSocketPluginOptions;
  private originalWebSocket: typeof WebSocket | null = null;
  private resolvedParser: ChunkParser | null = null;

  constructor(options: WebSocketPluginOptions = {}) {
    this.options = options;
  }

  setup(monitor: MonitorInstance): void {
    if (typeof WebSocket === 'undefined') return;

    if (this.options.parser) {
      this.resolvedParser = resolveParser(this.options.parser);
    }

    this.originalWebSocket = WebSocket;
    const OrigWS = WebSocket;
    const mon = monitor;
    const self = this;

    const PatchedWebSocket = function (
      this: WebSocket,
      url: string | URL,
      protocols?: string | string[],
    ) {
      const ws = new OrigWS(url, protocols);

      const urlStr = typeof url === 'string' ? url : url.toString();
      if (!self.shouldTrace(urlStr)) return ws;

      const parser = self.resolvedParser;
      parser?.reset();

      const trace = mon.createStreamTrace({
        messageId: `ws_${Date.now().toString(36)}`,
      });

      let firstMessageReceived = false;
      let isInThinking = false;
      let hasContentStarted = false;
      let traceEnded = false;

      ws.addEventListener('open', () => {
        trace.start();
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        if (traceEnded) return;

        if (!firstMessageReceived) {
          firstMessageReceived = true;
          trace.onFirstChunk();
        }

        if (!parser) return;

        const data = typeof event.data === 'string' ? event.data : '';
        if (!data) return;

        const lines = data.split('\n');
        for (const line of lines) {
          const chunk = parser.parse(line);
          if (!chunk) continue;

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
        }
      });

      ws.addEventListener('close', () => {
        if (!traceEnded) {
          traceEnded = true;
          if (isInThinking) trace.onPhase('thinking', 'end');
          if (hasContentStarted) trace.onPhase('generating', 'end');
          trace.complete();
        }
      });

      ws.addEventListener('error', () => {
        if (!traceEnded) {
          traceEnded = true;
          trace.error('WebSocket error');
        }
      });

      return ws;
    } as unknown as typeof WebSocket;

    Object.defineProperties(PatchedWebSocket, {
      CONNECTING: { value: OrigWS.CONNECTING },
      OPEN: { value: OrigWS.OPEN },
      CLOSING: { value: OrigWS.CLOSING },
      CLOSED: { value: OrigWS.CLOSED },
    });
    Object.setPrototypeOf(PatchedWebSocket, OrigWS);
    Object.setPrototypeOf(PatchedWebSocket.prototype, OrigWS.prototype);

    (globalThis as Record<string, unknown>).WebSocket = PatchedWebSocket;
  }

  teardown(): void {
    if (this.originalWebSocket) {
      (globalThis as Record<string, unknown>).WebSocket = this.originalWebSocket;
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
