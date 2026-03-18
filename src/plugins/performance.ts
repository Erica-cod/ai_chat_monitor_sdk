import type { MonitorPlugin, MonitorInstance } from '../core/types';
import { Monitor } from '../core/monitor';
import { isBrowser } from '../core/utils';

/**
 * 性能监控插件。
 * 基于 PerformanceObserver 采集 Web Vitals 核心指标：
 * - FCP (First Contentful Paint)
 * - LCP (Largest Contentful Paint)
 * - CLS (Cumulative Layout Shift)
 * - INP (Interaction to Next Paint)
 */
export class PerformancePlugin implements MonitorPlugin {
  readonly name = 'performance';
  readonly priority = 50;

  private observers: PerformanceObserver[] = [];

  setup(instance: MonitorInstance): void {
    if (!isBrowser() || typeof PerformanceObserver === 'undefined') return;

    const monitor = instance as Monitor;

    this.observeEntryType(monitor, 'paint', (entry) => {
      if (entry.name === 'first-contentful-paint') {
        monitor.emit(
          monitor.createEvent('web_vital', {
            name: 'FCP',
            value: Math.round(entry.startTime),
            unit: 'ms',
          }),
        );
      }
    });

    this.observeEntryType(monitor, 'largest-contentful-paint', (entry) => {
      monitor.emit(
        monitor.createEvent('web_vital', {
          name: 'LCP',
          value: Math.round(entry.startTime),
          unit: 'ms',
        }),
      );
    });

    this.observeEntryType(monitor, 'layout-shift', (entry) => {
      const lsEntry = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
      if (!lsEntry.hadRecentInput) {
        monitor.emit(
          monitor.createEvent('web_vital', {
            name: 'CLS',
            value: lsEntry.value,
            unit: 'score',
          }),
        );
      }
    });

    this.observeEntryType(monitor, 'event', (entry) => {
      const eventEntry = entry as PerformanceEntry & { processingStart: number; duration: number };
      if (eventEntry.duration > 40) {
        monitor.emit(
          monitor.createEvent('web_vital', {
            name: 'INP',
            value: Math.round(eventEntry.duration),
            unit: 'ms',
          }),
        );
      }
    });
  }

  teardown(): void {
    for (const observer of this.observers) {
      try {
        observer.disconnect();
      } catch {
        // 静默
      }
    }
    this.observers = [];
  }

  private observeEntryType(
    _monitor: Monitor,
    type: string,
    callback: (entry: PerformanceEntry) => void,
  ): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          try {
            callback(entry);
          } catch {
            // 单个回调异常不影响其他
          }
        }
      });
      observer.observe({ type, buffered: true });
      this.observers.push(observer);
    } catch {
      // 浏览器不支持该 entry type 时静默跳过
    }
  }
}
