import type { MonitorPlugin, MonitorInstance } from '../core/types';
import { isBrowser, isNode } from '../core/utils';
import { Monitor } from '../core/monitor';

export interface ErrorPluginOptions {
  /** 忽略匹配的错误消息 */
  ignoreErrors?: RegExp[];
  /** 忽略来自这些 URL 的错误 */
  ignoreUrls?: RegExp[];
  /** 是否捕获 console.error，默认 false */
  captureConsoleError?: boolean;
}

/**
 * 错误监控插件。
 * 浏览器：捕获 JS 运行时错误、未处理的 Promise 拒绝。
 * Node.js：捕获 uncaughtException、unhandledRejection。
 */
export class ErrorPlugin implements MonitorPlugin {
  readonly name = 'error';
  readonly priority = 50;

  private options: ErrorPluginOptions;
  private monitor: Monitor | null = null;
  private onError: ((event: ErrorEvent) => void) | null = null;
  private onRejection: ((event: PromiseRejectionEvent) => void) | null = null;
  private nodeUncaughtHandler: ((err: Error) => void) | null = null;
  private nodeRejectionHandler: ((reason: unknown) => void) | null = null;
  private originalConsoleError: typeof console.error | null = null;

  constructor(options: ErrorPluginOptions = {}) {
    this.options = options;
  }

  setup(instance: MonitorInstance): void {
    this.monitor = instance as Monitor;

    if (isBrowser()) {
      this.setupBrowser();
    } else if (isNode()) {
      this.setupNode();
    }

    if (this.options.captureConsoleError) {
      this.setupConsoleCapture();
    }
  }

  teardown(): void {
    if (isBrowser()) {
      if (this.onError) window.removeEventListener('error', this.onError, true);
      if (this.onRejection) window.removeEventListener('unhandledrejection', this.onRejection);
    }
    if (isNode()) {
      if (this.nodeUncaughtHandler) process.removeListener('uncaughtException', this.nodeUncaughtHandler);
      if (this.nodeRejectionHandler) process.removeListener('unhandledRejection', this.nodeRejectionHandler);
    }
    if (this.originalConsoleError) console.error = this.originalConsoleError;
  }

  private setupBrowser(): void {
    this.onError = (event: ErrorEvent) => {
      if (!event.error) return;
      if (this.shouldIgnore(event.message, event.filename)) return;

      this.monitor!.emit(
        this.monitor!.createEvent('js_error', {
          message: event.error.message ?? event.message,
          stack: event.error.stack,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        }),
      );
    };

    this.onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      if (this.shouldIgnore(message)) return;

      this.monitor!.emit(
        this.monitor!.createEvent('promise_error', {
          message,
          stack: reason instanceof Error ? reason.stack : undefined,
        }),
      );
    };

    window.addEventListener('error', this.onError, true);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  private setupNode(): void {
    this.nodeUncaughtHandler = (err: Error) => {
      if (this.shouldIgnore(err.message)) return;

      this.monitor!.emit(
        this.monitor!.createEvent('js_error', {
          message: err.message,
          stack: err.stack,
          source: 'uncaughtException',
        }),
      );
    };

    this.nodeRejectionHandler = (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (this.shouldIgnore(message)) return;

      this.monitor!.emit(
        this.monitor!.createEvent('promise_error', {
          message,
          stack: reason instanceof Error ? (reason as Error).stack : undefined,
          source: 'unhandledRejection',
        }),
      );
    };

    process.on('uncaughtException', this.nodeUncaughtHandler);
    process.on('unhandledRejection', this.nodeRejectionHandler);
  }

  private setupConsoleCapture(): void {
    this.originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      this.originalConsoleError!.apply(console, args);
      const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      if (!this.shouldIgnore(message)) {
        this.monitor!.emit(
          this.monitor!.createEvent('js_error', {
            message,
            source: 'console.error',
          }),
        );
      }
    };
  }

  private shouldIgnore(message?: string, url?: string): boolean {
    if (message && this.options.ignoreErrors?.some((re) => re.test(message))) return true;
    if (url && this.options.ignoreUrls?.some((re) => re.test(url))) return true;
    return false;
  }
}
