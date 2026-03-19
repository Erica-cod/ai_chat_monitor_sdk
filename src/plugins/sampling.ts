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
 *
 * 通过 beforeEmit 钩子实现过滤，不再 monkey-patch monitor.emit。
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

  setup(_monitor: MonitorInstance): void {
    // 采样逻辑已迁移到 beforeEmit，setup 无需额外操作
  }

  processEvent(event: MonitorEvent): MonitorEvent | null {
    return this.shouldSample(event) ? event : null;
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
