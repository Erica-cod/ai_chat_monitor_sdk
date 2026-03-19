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
  StreamTrace,
  StreamTraceOptions,
  StreamResult,
} from './types';

const DEFAULT_CONFIG: Omit<Required<MonitorConfig>, 'appId'> = {
  endpoint: '/api/monitor',
  debug: false,
  version: '',
};

/** beforeSend 回调类型 */
type BeforeSendFn = (event: MonitorEvent) => MonitorEvent | null;

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
  private beforeSendFn: BeforeSendFn | null = null;

  constructor(config: MonitorConfig, beforeSend?: BeforeSendFn) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<MonitorConfig>;
    this.bus = new EventBus();
    this.ctxManager = new ContextManager(this.config);
    this.runner = new PluginRunner();
    this.beforeSendFn = beforeSend ?? null;
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

    let processed = this.runner.runProcessEvent(event);
    if (!processed) return;

    if (this.beforeSendFn) {
      try {
        processed = this.beforeSendFn(processed);
      } catch {
        // beforeSend 异常不影响管道
      }
      if (!processed) return;
    }

    this.bus.emit('event', processed);
    this.log('Event emitted', { type: processed.type, id: processed.id });
  }

  send(events: MonitorEvent[]): void {
    if (this.destroyed) return;
    this.bus.emit('transport:send', events);
  }

  setContext(partial: Partial<MonitorContext>): void {
    this.ctxManager.update(partial);
  }

  createStreamTrace(options: StreamTraceOptions): StreamTrace {
    return new StreamTraceImpl(this, options);
  }

  /** @deprecated 请使用 createStreamTrace() */
  createSSETrace(options: StreamTraceOptions): StreamTrace {
    return this.createStreamTrace(options);
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

  signal(name: string, data?: unknown): void {
    if (this.destroyed) return;
    this.bus.emit(name, data);
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
 * 流式追踪实例。
 * 追踪一次 AI 流式响应的完整生命周期，支持 TTFT、TTLB、TPS、token 统计。
 */
class StreamTraceImpl implements StreamTrace {
  readonly traceId: string;
  readonly messageId: string;

  private monitor: Monitor;
  private model?: string;
  private provider?: string;
  private stallThreshold: number;
  private previousTraceId?: string;
  private startTime = 0;
  private firstChunkTime = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private lastChunkTime = 0;
  private phases: Map<string, number> = new Map();
  private ended = false;

  constructor(monitor: Monitor, options: StreamTraceOptions) {
    this.monitor = monitor;
    this.traceId = uid();
    this.messageId = options.messageId;
    this.model = options.model;
    this.provider = options.provider;
    this.stallThreshold = options.stallThreshold ?? 5000;
    this.previousTraceId = options.previousTraceId;
  }

  /** 每个事件都携带的公共字段 */
  private baseData(): Record<string, unknown> {
    const d: Record<string, unknown> = {
      traceId: this.traceId,
      messageId: this.messageId,
    };
    if (this.model) d.model = this.model;
    if (this.provider) d.provider = this.provider;
    return d;
  }

  start(): void {
    this.startTime = now();
    this.lastChunkTime = this.startTime;
    this.resetStallTimer();

    this.monitor.emit(
      this.monitor.createEvent('stream_start', {
        ...this.baseData(),
        previousTraceId: this.previousTraceId,
      }),
    );
  }

  onFirstChunk(): void {
    this.firstChunkTime = now();
    this.lastChunkTime = this.firstChunkTime;
    this.resetStallTimer();

    const ttft = this.firstChunkTime - this.startTime;
    this.monitor.emit(
      this.monitor.createEvent('stream_first_token', {
        ...this.baseData(),
        ttft,
      }),
    );
  }

  onPhase(phase: string, action: 'start' | 'end'): void {
    const t = now();
    this.lastChunkTime = t;
    this.resetStallTimer();

    const data: Record<string, unknown> = {
      ...this.baseData(),
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

    this.monitor.emit(this.monitor.createEvent('stream_phase', data));
  }

  onToolCall(toolName: string, params?: Record<string, unknown>): void {
    this.lastChunkTime = now();
    this.resetStallTimer();

    this.monitor.emit(
      this.monitor.createEvent('stream_tool_call', {
        ...this.baseData(),
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
      this.monitor.createEvent('stream_tool_call', {
        ...this.baseData(),
        toolName,
        action: 'end',
        result,
      }),
    );
  }

  complete(result?: StreamResult): void {
    if (this.ended) return;
    this.ended = true;
    this.clearStallTimer();

    const completeTime = now();
    const ttlb = completeTime - this.startTime;
    const ttft = this.firstChunkTime ? this.firstChunkTime - this.startTime : undefined;
    const generationDuration = this.firstChunkTime ? completeTime - this.firstChunkTime : undefined;

    const totalTokens =
      result?.totalTokens ??
      (result?.promptTokens != null && result?.completionTokens != null
        ? result.promptTokens + result.completionTokens
        : undefined);

    const tps =
      result?.completionTokens && generationDuration && generationDuration > 0
        ? Math.round((result.completionTokens / generationDuration) * 1000 * 100) / 100
        : undefined;

    const { promptTokens, completionTokens, model, ...extraMeta } = result ?? {};

    this.monitor.emit(
      this.monitor.createEvent('stream_complete', {
        ...this.baseData(),
        ttft,
        ttlb,
        generationDuration,
        promptTokens,
        completionTokens,
        totalTokens,
        tps,
        ...(model && { model }),
        ...extraMeta,
      }),
    );
  }

  error(err: Error | string): void {
    if (this.ended) return;
    this.ended = true;
    this.clearStallTimer();

    const errorTime = now();
    this.monitor.emit(
      this.monitor.createEvent('stream_error', {
        ...this.baseData(),
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
      this.monitor.createEvent('stream_complete', {
        ...this.baseData(),
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
        this.monitor.createEvent('stream_stall', {
          ...this.baseData(),
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
