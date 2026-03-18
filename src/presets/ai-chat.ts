import { Monitor } from '../core/monitor';
import { ErrorPlugin } from '../plugins/error';
import { TransportPlugin } from '../plugins/transport';
import { SessionPlugin } from '../plugins/session';
import { SamplingPlugin } from '../plugins/sampling';
import { DedupePlugin } from '../plugins/dedupe';
import { FetchPlugin } from '../plugins/fetch';
import { PerformancePlugin } from '../plugins/performance';
import type { AIChatMonitorConfig, MonitorInstance } from '../core/types';

/**
 * 检测当前环境是否为开发模式
 */
function isDevMode(): boolean {
  try {
    // 兼容浏览器和 Node.js 环境：通过 globalThis 安全访问 process
    const g = globalThis as Record<string, unknown>;
    const proc = g.process as { env?: Record<string, string> } | undefined;
    const env = proc?.env?.NODE_ENV;
    return env === 'development' || env === 'test';
  } catch {
    return false;
  }
}

/**
 * 创建 AI 对话专用监控实例（开箱即用）。
 *
 * @example
 * ```ts
 * // 最简接入
 * const monitor = createAIChatMonitor({ appId: 'my-ai-app' })
 *
 * // 带配置
 * const monitor = createAIChatMonitor({
 *   appId: 'my-ai-app',
 *   endpoint: '/api/telemetry',
 *   preset: 'production',
 *   sampling: { rate: 0.1 },
 * })
 * ```
 */
export function createAIChatMonitor(config: AIChatMonitorConfig): MonitorInstance {
  const isDev = isDevMode();
  const preset = config.preset ?? (isDev ? 'development' : 'production');

  const monitor = new Monitor({
    appId: config.appId,
    endpoint: config.endpoint,
    debug: config.debug ?? (preset === 'development'),
    version: config.version,
  });

  // 采样
  const samplingRate =
    config.sampling?.rate ?? (preset === 'production' ? 0.1 : preset === 'minimal' ? 0.05 : 1.0);
  monitor.use(
    new SamplingPlugin({
      rate: samplingRate,
      alwaysSample: config.sampling?.alwaysSample ?? ['js_error', 'promise_error', 'sse_error'],
    }),
  );

  // 去重
  monitor.use(new DedupePlugin({ windowMs: config.dedupeWindow }));

  // 会话
  monitor.use(new SessionPlugin());

  if (preset !== 'minimal') {
    // 错误监控
    monitor.use(
      new ErrorPlugin({
        ignoreErrors: config.error?.ignoreErrors ?? [/ResizeObserver/],
        ignoreUrls: config.error?.ignoreUrls ?? [/chrome-extension/],
      }),
    );

    // Fetch 拦截
    monitor.use(
      new FetchPlugin({
        includeUrls: config.fetch?.includeUrls,
        excludeUrls: config.fetch?.excludeUrls ?? [/\/api\/monitor/],
      }),
    );

    // 性能指标
    monitor.use(new PerformancePlugin());
  } else {
    // minimal 模式只有错误
    monitor.use(new ErrorPlugin({ ignoreErrors: config.error?.ignoreErrors }));
  }

  // 传输
  monitor.use(
    new TransportPlugin({
      endpoint: config.endpoint,
      mode: config.transport?.mode ?? (preset === 'development' ? 'immediate' : 'batch'),
      batchSize: config.transport?.batchSize,
      flushInterval: config.transport?.flushInterval,
      maxRetries: config.transport?.maxRetries,
    }),
  );

  monitor.init();
  return monitor;
}

/**
 * 创建最小化监控实例（仅错误监控）。
 */
export function createMinimalMonitor(
  config: Pick<AIChatMonitorConfig, 'appId' | 'endpoint' | 'debug' | 'version'>,
): MonitorInstance {
  return createAIChatMonitor({ ...config, preset: 'minimal' });
}
