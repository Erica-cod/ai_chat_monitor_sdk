import { EventBus } from './event-bus';
import { ContextManager } from './context';
import { PluginRunner } from './plugin-runner';
import { StreamTraceImpl } from './stream-trace';
import { uid, now } from './utils';
import type {
  MonitorConfig,
  MonitorContext,
  MonitorEvent,
  MonitorEventType,
  MonitorInstance,
  MonitorPlugin,
  StreamTrace,
  StreamTraceOptions,
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
    this.bus = new EventBus(this.config.debug);
    this.ctxManager = new ContextManager(this.config);
    this.runner = new PluginRunner(this.config.debug);
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
      } catch (err) {
        this.log('beforeSend threw an error', err);
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

  createEvent(type: MonitorEventType, data: Record<string, unknown>): MonitorEvent {
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
