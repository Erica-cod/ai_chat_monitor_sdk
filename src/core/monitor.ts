import { EventBus } from './event-bus';
import { ContextManager } from './context';
import { PluginRunner } from './plugin-runner';
import { uid, now } from './utils';
import type {
  MonitorConfig,
  MonitorContext,
  MonitorEvent,
  MonitorInstance,
  MonitorPlugin,
  SSETrace,
  SSETraceOptions,
} from './types';

const DEFAULT_CONFIG: Omit<Required<MonitorConfig>, 'appId'> = {
  endpoint: '/api/monitor',
  debug: false,
  version: '',
};

/**
 * Monitor 核心类。
 *
 * 职责：管理插件生命周期、事件管道、全局上下文。
 * 所有采集逻辑由插件实现，Monitor 本身保持精简。
 */
export class Monitor implements MonitorInstance {
  readonly config: Required<MonitorConfig>;
  private bus: EventBus;
  private ctxManager: ContextManager;
  private runner: PluginRunner;
  private destroyed = false;

  constructor(config: MonitorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<MonitorConfig>;
    this.bus = new EventBus();
    this.ctxManager = new ContextManager(this.config);
    this.runner = new PluginRunner();
  }

  get context(): MonitorContext {
    return this.ctxManager.current;
  }

  use(plugin: MonitorPlugin): this {
    if (this.destroyed) return this;
    this.runner.register(plugin);
    return this;
  }

  /** 初始化所有已注册插件（需在 use() 全部调用后执行） */
  init(): this {
    this.runner.setupAll(this);
    this.log('Monitor initialized', {
      plugins: this.runner.getPluginNames(),
      config: { appId: this.config.appId, endpoint: this.config.endpoint },
    });
    return this;
  }

  emit(event: MonitorEvent): void {
    if (this.destroyed) return;
    this.bus.emit('event', event);
    this.log('Event emitted', { type: event.type, id: event.id });
  }

  send(events: MonitorEvent[]): void {
    if (this.destroyed) return;
    this.bus.emit('transport:send', events);
  }

  setContext(partial: Partial<MonitorContext>): void {
    this.ctxManager.update(partial);
  }

  createSSETrace(options: SSETraceOptions): SSETrace {
    return new SSETraceImpl(this, options);
  }

  /** 创建一个带有上下文的监控事件 */
  createEvent(type: MonitorEvent['type'], data: Record<string, unknown>): MonitorEvent {
    return {
      id: uid(),
      type,
      timestamp: now(),
      data,
      context: this.context,
    };
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.bus.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.bus.off(event, handler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.runner.teardownAll();
    this.bus.clear();
    this.log('Monitor destroyed');
  }

  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      console.log(`[ai-stream-monitor] ${message}`, data ?? '');
    }
  }
}

/**
 * SSE 追踪实例。
 * 追踪一次 SSE 流式响应的完整生命周期。
 */
class SSETraceImpl implements SSETrace {
  readonly traceId: string;
  readonly messageId: string;

  private monitor: Monitor;
  private stallThreshold: number;
  private previousTraceId?: string;
  private startTime = 0;
  private firstChunkTime = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private lastChunkTime = 0;
  private phases: Map<string, number> = new Map();
  private ended = false;

  constructor(monitor: Monitor, options: SSETraceOptions) {
    this.monitor = monitor;
    this.traceId = uid();
    this.messageId = options.messageId;
    this.stallThreshold = options.stallThreshold ?? 5000;
    this.previousTraceId = options.previousTraceId;
  }

  start(): void {
    this.startTime = now();
    this.lastChunkTime = this.startTime;
    this.resetStallTimer();

    this.monitor.emit(
      this.monitor.createEvent('sse_start', {
        traceId: this.traceId,
        messageId: this.messageId,
        previousTraceId: this.previousTraceId,
      }),
    );
  }

  onFirstChunk(): void {
    this.firstChunkTime = now();
    this.lastChunkTime = this.firstChunkTime;
    this.resetStallTimer();

    const ttfb = this.firstChunkTime - this.startTime;
    this.monitor.emit(
      this.monitor.createEvent('sse_first_chunk', {
        traceId: this.traceId,
        messageId: this.messageId,
        ttfb,
      }),
    );
  }

  onPhase(phase: string, action: 'start' | 'end'): void {
    const t = now();
    this.lastChunkTime = t;
    this.resetStallTimer();

    const data: Record<string, unknown> = {
      traceId: this.traceId,
      messageId: this.messageId,
      phase,
      action,
    };

    if (action === 'start') {
      this.phases.set(phase, t);
    } else {
      const startT = this.phases.get(phase);
      if (startT) {
        data.duration = t - startT;
        this.phases.delete(phase);
      }
    }

    this.monitor.emit(this.monitor.createEvent('sse_phase', data));
  }

  onToolCall(toolName: string, params?: Record<string, unknown>): void {
    this.lastChunkTime = now();
    this.resetStallTimer();

    this.monitor.emit(
      this.monitor.createEvent('sse_tool_call', {
        traceId: this.traceId,
        messageId: this.messageId,
        toolName,
        action: 'start',
        params,
      }),
    );
  }

  onToolResult(toolName: string, result?: Record<string, unknown>): void {
    this.lastChunkTime = now();
    this.resetStallTimer();

    this.monitor.emit(
      this.monitor.createEvent('sse_tool_call', {
        traceId: this.traceId,
        messageId: this.messageId,
        toolName,
        action: 'end',
        result,
      }),
    );
  }

  complete(meta?: Record<string, unknown>): void {
    if (this.ended) return;
    this.ended = true;
    this.clearStallTimer();

    const completeTime = now();
    const ttlb = completeTime - this.startTime;
    const ttfb = this.firstChunkTime ? this.firstChunkTime - this.startTime : undefined;

    this.monitor.emit(
      this.monitor.createEvent('sse_complete', {
        traceId: this.traceId,
        messageId: this.messageId,
        ttfb,
        ttlb,
        ...meta,
      }),
    );
  }

  error(err: Error | string): void {
    if (this.ended) return;
    this.ended = true;
    this.clearStallTimer();

    const errorTime = now();
    this.monitor.emit(
      this.monitor.createEvent('sse_error', {
        traceId: this.traceId,
        messageId: this.messageId,
        message: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined,
        elapsed: errorTime - this.startTime,
      }),
    );
  }

  abort(): void {
    if (this.ended) return;
    this.ended = true;
    this.clearStallTimer();

    this.monitor.emit(
      this.monitor.createEvent('sse_complete', {
        traceId: this.traceId,
        messageId: this.messageId,
        aborted: true,
        elapsed: now() - this.startTime,
      }),
    );
  }

  private resetStallTimer(): void {
    this.clearStallTimer();
    if (this.ended || this.stallThreshold <= 0) return;

    this.stallTimer = setTimeout(() => {
      if (this.ended) return;
      const stallDuration = now() - this.lastChunkTime;
      this.monitor.emit(
        this.monitor.createEvent('sse_stall', {
          traceId: this.traceId,
          messageId: this.messageId,
          stallDuration,
          threshold: this.stallThreshold,
        }),
      );
    }, this.stallThreshold);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }
}
