import type { MonitorPlugin, MonitorInstance, StreamTrace } from '../core/types';
import { Monitor } from '../core/monitor';
import { now } from '../core/utils';

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
}

/**
 * Fetch 拦截插件（流式感知版本）。
 *
 * 普通请求：记录 url / method / status / duration。
 * AI 流式响应：自动创建 StreamTrace，包裹 ReadableStream 追踪
 * TTFT、TTLB、chunkCount、totalBytes。
 */
export class FetchPlugin implements MonitorPlugin {
  readonly name = 'fetch';
  readonly priority = 50;

  private options: FetchPluginOptions;
  private originalFetch: typeof fetch | null = null;

  constructor(options: FetchPluginOptions = {}) {
    this.options = options;
  }

  setup(instance: MonitorInstance): void {
    if (typeof fetch === 'undefined') return;

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
    // 没有 includeUrls 时，只拦截 streamPatterns 匹配的 URL，不再劫持全部请求
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
   * 使用 TransformStream 作为中间层，对业务代码完全透明。
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

    const finalize = (aborted: boolean) => {
      if (completed) return;
      completed = true;
      if (aborted) {
        trace.abort();
      } else {
        trace.complete({ chunkCount, totalBytes, url });
      }
    };

    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finalize(false);
            controller.close();
            return;
          }
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            trace.onFirstChunk();
          }
          chunkCount++;
          totalBytes += value.byteLength;
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
