import { Monitor } from '../core/monitor';
import { ErrorPlugin } from '../plugins/error';
import { TransportPlugin } from '../plugins/transport';
import { SessionPlugin } from '../plugins/session';
import { SamplingPlugin } from '../plugins/sampling';
import { DedupePlugin } from '../plugins/dedupe';
import { FetchPlugin } from '../plugins/fetch';
import { PerformancePlugin } from '../plugins/performance';
import { OfflineQueuePlugin } from '../plugins/offline-queue';
import type { AIChatMonitorConfig, MonitorInstance } from '../core/types';

/**
 * 检测当前环境是否为开发模式
 */
function isDevMode(): boolean {
  try {
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
 * // 带配置（自动解析 OpenAI 兼容格式的流式内容）
 * const monitor = createAIChatMonitor({
 *   appId: 'my-ai-app',
 *   endpoint: '/api/telemetry',
 *   preset: 'production',
 *   sampling: { rate: 0.1 },
 *   fetch: { streamPatterns: [/\/api\/chat/, /\/v1\/completions/] },
 *   parser: 'openai',
 * })
 * ```
 */
export function createAIChatMonitor(config: AIChatMonitorConfig): MonitorInstance {
  const isDev = isDevMode();
  const preset = config.preset ?? (isDev ? 'development' : 'production');

  const monitor = new Monitor(
    {
      appId: config.appId,
      endpoint: config.endpoint,
      debug: config.debug ?? (preset === 'development'),
      version: config.version,
    },
    config.beforeSend,
  );

  // 采样
  const samplingRate =
    config.sampling?.rate ?? (preset === 'production' ? 0.1 : preset === 'minimal' ? 0.05 : 1.0);
  monitor.use(
    new SamplingPlugin({
      rate: samplingRate,
      alwaysSample: config.sampling?.alwaysSample ?? ['js_error', 'promise_error', 'stream_error'],
    }),
  );

  // 去重
  monitor.use(new DedupePlugin({ windowMs: config.dedupeWindow }));

  // 会话
  monitor.use(new SessionPlugin());

  // 错误监控（默认启用，可通过 error.enabled: false 显式关闭）
  if (config.error?.enabled !== false) {
    const useFullConfig = preset !== 'minimal';
    monitor.use(
      new ErrorPlugin({
        ignoreErrors: config.error?.ignoreErrors ?? (useFullConfig ? [/ResizeObserver/] : undefined),
        ignoreUrls: config.error?.ignoreUrls ?? (useFullConfig ? [/chrome-extension/] : undefined),
      }),
    );
  }

  // Fetch 拦截（默认不启用，需显式传入 streamPatterns 或设置 enabled: true）
  // 劫持全局 fetch 具有破坏性（会影响 OIDC 登录、CSRF 请求等），因此改为 opt-in。
  const fetchEnabled =
    preset !== 'minimal' &&
    config.fetch?.enabled !== false &&
    (config.fetch?.enabled === true ||
      (config.fetch?.streamPatterns && config.fetch.streamPatterns.length > 0) ||
      (config.fetch?.includeUrls && config.fetch.includeUrls.length > 0));

  if (fetchEnabled) {
    monitor.use(
      new FetchPlugin({
        includeUrls: config.fetch?.includeUrls,
        excludeUrls: config.fetch?.excludeUrls ?? [/\/api\/monitor/],
        streamPatterns: config.fetch?.streamPatterns,
        parser: config.parser,
      }),
    );
  }

  // 性能监控（minimal 模式不启用）
  if (preset !== 'minimal') {
    monitor.use(new PerformancePlugin());
  }

  // 传输
  monitor.use(
    new TransportPlugin({
      endpoint: config.endpoint,
      mode: config.transport?.mode ?? (preset === 'development' ? 'immediate' : 'batch'),
      batchSize: config.transport?.batchSize,
      flushInterval: config.transport?.flushInterval,
      maxRetries: config.transport?.maxRetries,
      headers: config.transport?.headers,
      customSend: config.transport?.customSend,
    }),
  );

  // 离线队列（production 模式默认启用，为弱网场景提供容错）
  if (preset === 'production') {
    monitor.use(new OfflineQueuePlugin());
  }

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
