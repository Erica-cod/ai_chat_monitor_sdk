import type { MonitorPlugin, MonitorInstance, StreamTrace, ChunkParser, BuiltinParserName } from '../core/types';
import { Monitor } from '../core/monitor';
import { now } from '../core/utils';
import { resolveParser } from '../parsers/index';

export interface FetchPluginOptions {
  /** 只拦截匹配的 URL */
  includeUrls?: RegExp[];
  /** 排除匹配的 URL（优先级高于 includeUrls） */
  excludeUrls?: RegExp[];
  /**
   * 匹配的 URL 会被识别为 AI 流式端点。
   * 当响应的 content-type 为 text/event-stream 或 body 为 ReadableStream 时，
   * 自动创建 StreamTrace 追踪整个流的生命周期。
   */
  streamPatterns?: RegExp[];
  /**
   * 流式内容解析器。配置后将解析 SSE 内容，
   * 自动驱动 StreamTrace 的 thinking 阶段、tool call、token 用量等。
   * 不配置时行为与之前一致（仅字节级追踪）。
   */
  parser?: BuiltinParserName | ChunkParser;
}

/**
 * Fetch 拦截插件（流式感知版本）。
 *
 * 普通请求：记录 url / method / status / duration。
 * AI 流式响应：自动创建 StreamTrace，包裹 ReadableStream 追踪
 * TTFT、TTLB、chunkCount、totalBytes。
 * 配置 parser 后还可自动识别 thinking 阶段、tool call、token 用量。
 */
export class FetchPlugin implements MonitorPlugin {
  readonly name = 'fetch';
  readonly priority = 50;

  private options: FetchPluginOptions;
  private originalFetch: typeof fetch | null = null;
  private resolvedParser: ChunkParser | null = null;

  constructor(options: FetchPluginOptions = {}) {
    this.options = options;
  }

  setup(instance: MonitorInstance): void {
    if (typeof fetch === 'undefined') return;

    if (this.options.parser) {
      this.resolvedParser = resolveParser(this.options.parser);
    }

    const monitor = instance as Monitor;
    const endpoint = monitor.config.endpoint;
    const self = this;

    const target = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : undefined);
    if (!target || typeof (target as Record<string, unknown>).fetch !== 'function') return;

    this.originalFetch = (target as Record<string, unknown>).fetch as typeof fetch;
    const origFetch = this.originalFetch.bind(target);

    (target as Record<string, unknown>).fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes(endpoint)) {
        return origFetch(input, init);
      }

      if (!self.shouldIntercept(url)) {
        return origFetch(input, init);
      }

      const method = init?.method?.toUpperCase() ?? 'GET';
      const startTime = now();
      const isStreamUrl = self.isStreamEndpoint(url);

      try {
        const response = await origFetch(input, init);
        const headerDuration = now() - startTime;

        monitor.emit(
          monitor.createEvent('http_request', {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            duration: headerDuration,
            ok: response.ok,
            streaming: isStreamUrl && self.isStreamResponse(response),
          }),
        );

        if (isStreamUrl && self.isStreamResponse(response) && response.body) {
          return self.wrapStreamResponse(response, monitor, url);
        }

        return response;
      } catch (err) {
        const duration = now() - startTime;

        monitor.emit(
          monitor.createEvent('http_request', {
            url,
            method,
            status: 0,
            duration,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );

        throw err;
      }
    };
  }

  teardown(): void {
    if (this.originalFetch) {
      const target = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : undefined);
      if (target) {
        (target as Record<string, unknown>).fetch = this.originalFetch;
      }
    }
  }

  private shouldIntercept(url: string): boolean {
    if (this.options.excludeUrls?.some((re) => re.test(url))) return false;
    if (this.options.includeUrls && this.options.includeUrls.length > 0) {
      return this.options.includeUrls.some((re) => re.test(url));
    }
    if (this.options.streamPatterns && this.options.streamPatterns.length > 0) {
      return this.options.streamPatterns.some((re) => re.test(url));
    }
    return false;
  }

  private isStreamEndpoint(url: string): boolean {
    if (!this.options.streamPatterns || this.options.streamPatterns.length === 0) return false;
    return this.options.streamPatterns.some((re) => re.test(url));
  }

  private isStreamResponse(response: Response): boolean {
    const ct = response.headers.get('content-type') ?? '';
    return ct.includes('text/event-stream') || ct.includes('application/stream') || !!response.body;
  }

  /**
   * 包裹 Response 的 ReadableStream body，在数据流经时自动追踪生命周期。
   * 配置了 parser 时，还会解码文本、逐行解析，自动驱动 trace 的语义事件。
   */
  private wrapStreamResponse(response: Response, monitor: Monitor, url: string): Response {
    const body = response.body!;
    const reader = body.getReader();
    const trace: StreamTrace = monitor.createStreamTrace({
      messageId: `fetch_${Date.now().toString(36)}`,
    });

    trace.start();

    let firstChunkReceived = false;
    let chunkCount = 0;
    let totalBytes = 0;
    let completed = false;

    const parser = this.resolvedParser;
    const decoder = parser ? new TextDecoder() : null;
    let textBuffer = '';
    let isInThinking = false;
    let hasContentStarted = false;
    const reportedToolCalls = new Set<string>();

    const finalize = (aborted: boolean, tokenUsage?: Record<string, number | undefined>) => {
      if (completed) return;
      completed = true;
      if (aborted) {
        trace.abort();
      } else {
        const result: Record<string, unknown> = { chunkCount, totalBytes, url };
        if (tokenUsage) {
          if (tokenUsage.promptTokens != null) result.promptTokens = tokenUsage.promptTokens;
          if (tokenUsage.completionTokens != null) result.completionTokens = tokenUsage.completionTokens;
          if (tokenUsage.totalTokens != null) result.totalTokens = tokenUsage.totalTokens;
        }
        trace.complete(result);
      }
    };

    const processLines = (text: string) => {
      if (!parser) return;
      textBuffer += text;
      const lines = textBuffer.split('\n');
      textBuffer = lines.pop() || '';

      for (const line of lines) {
        const chunk = parser.parse(line);
        if (!chunk) continue;

        // thinking 阶段自动检测
        if (chunk.thinking && !isInThinking) {
          isInThinking = true;
          trace.onPhase('thinking', 'start');
        }
        if (isInThinking && chunk.content && !chunk.thinking) {
          isInThinking = false;
          trace.onPhase('thinking', 'end');
        }

        // generating 阶段自动检测
        if (chunk.content && !hasContentStarted) {
          hasContentStarted = true;
          if (!isInThinking) {
            trace.onPhase('generating', 'start');
          }
        }

        // 工具调用
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            const key = `${tc.name}_${JSON.stringify(tc.arguments)}`;
            if (!reportedToolCalls.has(key)) {
              reportedToolCalls.add(key);
              trace.onToolCall(tc.name, tc.arguments);
            }
          }
        }

        // 完成
        if (chunk.done) {
          if (isInThinking) {
            trace.onPhase('thinking', 'end');
            isInThinking = false;
          }
          if (hasContentStarted) {
            trace.onPhase('generating', 'end');
          }
          finalize(false, chunk.tokenUsage as Record<string, number | undefined> | undefined);
        }
      }
    };

    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (parser && textBuffer.trim()) {
              processLines('\n');
            }
            if (!completed) finalize(false);
            controller.close();
            return;
          }
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            trace.onFirstChunk();
          }
          chunkCount++;
          totalBytes += value.byteLength;

          if (decoder) {
            processLines(decoder.decode(value, { stream: true }));
          }

          controller.enqueue(value);
        } catch (err) {
          finalize(true);
          controller.error(err);
        }
      },
      cancel() {
        reader.cancel();
        finalize(true);
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}
