import type { MonitorPlugin, MonitorInstance } from '../core/types';
import { Monitor } from '../core/monitor';
import { now, isBrowser } from '../core/utils';

export interface FetchPluginOptions {
  /** 只拦截匹配的 URL */
  includeUrls?: RegExp[];
  /** 排除匹配的 URL（优先级高于 includeUrls） */
  excludeUrls?: RegExp[];
}

/**
 * Fetch 拦截插件。
 * 自动监控 fetch 请求的耗时、状态码、错误。
 * 排除 SDK 自身的上报请求。
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
    if (!isBrowser() || typeof fetch === 'undefined') return;

    const monitor = instance as Monitor;
    const endpoint = monitor.config.endpoint;
    const self = this;

    this.originalFetch = window.fetch.bind(window);
    const origFetch = this.originalFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      // 不拦截 SDK 自身的上报请求
      if (url.includes(endpoint)) {
        return origFetch(input, init);
      }

      if (!self.shouldIntercept(url)) {
        return origFetch(input, init);
      }

      const method = init?.method?.toUpperCase() ?? 'GET';
      const startTime = now();

      try {
        const response = await origFetch(input, init);
        const duration = now() - startTime;

        monitor.emit(
          monitor.createEvent('http_request', {
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            duration,
            ok: response.ok,
          }),
        );

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
    if (this.originalFetch && isBrowser()) {
      window.fetch = this.originalFetch;
    }
  }

  private shouldIntercept(url: string): boolean {
    if (this.options.excludeUrls?.some((re) => re.test(url))) return false;
    if (this.options.includeUrls && this.options.includeUrls.length > 0) {
      return this.options.includeUrls.some((re) => re.test(url));
    }
    return true;
  }
}
