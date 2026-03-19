import type { MonitorPlugin, MonitorInstance, MonitorEvent, MonitorEventType } from '../core/types';

export interface SamplingPluginOptions {
  /** 默认采样率 (0~1)，默认 1.0 */
  rate?: number;
  /** 按事件类型设置独立采样率 */
  typeRates?: Partial<Record<MonitorEventType, number>>;
  /** 这些事件类型总是采样（不受 rate 限制） */
  alwaysSample?: MonitorEventType[];
}

/**
 * 采样插件。
 * 基于会话级采样决策 + 按事件类型差异化采样。
 * 一旦决定采样当前会话，整个会话内所有事件都会被采集（保证一致性）。
 */
export class SamplingPlugin implements MonitorPlugin {
  readonly name = 'sampling';
  readonly priority = 10;

  private options: Required<SamplingPluginOptions>;
  private sessionSampled: boolean;

  constructor(options: SamplingPluginOptions = {}) {
    this.options = {
      rate: options.rate ?? 1.0,
      typeRates: options.typeRates ?? {},
      alwaysSample: options.alwaysSample ?? ['js_error', 'promise_error', 'stream_error'],
    };
    this.sessionSampled = Math.random() < this.options.rate;
  }

  setup(monitor: MonitorInstance): void {
    const originalEmit = monitor.emit.bind(monitor);

    // 拦截 event 事件，根据采样策略决定是否放行
    monitor.on('event', (...args: unknown[]) => {
      // 采样逻辑由事件总线管道处理，这里通过 event-filter 通知后续插件
      const event = args[0] as MonitorEvent;
      if (!this.shouldSample(event)) {
        // 阻止事件继续传播：不做任何事，事件不会到达 transport
        return;
      }
    });

    // 重写 emit 增加采样过滤
    const self = this;
    const monitorAny = monitor as { emit: typeof originalEmit };
    const parentEmit = monitorAny.emit;
    monitorAny.emit = function (event: MonitorEvent) {
      if (!self.shouldSample(event)) return;
      parentEmit(event);
    };
  }

  private shouldSample(event: MonitorEvent): boolean {
    if (this.options.alwaysSample.includes(event.type)) return true;
    if (!this.sessionSampled) return false;

    const typeRate = this.options.typeRates[event.type];
    if (typeRate !== undefined) {
      return Math.random() < typeRate;
    }
    return true;
  }
}
