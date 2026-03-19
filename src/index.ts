// 核心
export { Monitor } from './core/monitor';
export { EventBus } from './core/event-bus';
export type {
  MonitorConfig,
  MonitorContext,
  MonitorEvent,
  MonitorEventType,
  BuiltinEventType,
  MonitorInstance,
  MonitorPlugin,
  StreamTrace,
  StreamTraceOptions,
  StreamResult,
  SSETrace,
  SSETraceOptions,
  AIChatMonitorConfig,
  PresetMode,
} from './core/types';

// 预设（开箱即用入口）
export { createAIChatMonitor, createMinimalMonitor } from './presets/ai-chat';

// 插件（按需引入）
export { ErrorPlugin } from './plugins/error';
export type { ErrorPluginOptions } from './plugins/error';
export { TransportPlugin } from './plugins/transport';
export type { TransportPluginOptions } from './plugins/transport';
export { SessionPlugin } from './plugins/session';
export { SamplingPlugin } from './plugins/sampling';
export type { SamplingPluginOptions } from './plugins/sampling';
export { DedupePlugin } from './plugins/dedupe';
export type { DedupePluginOptions } from './plugins/dedupe';
export { FetchPlugin } from './plugins/fetch';
export type { FetchPluginOptions } from './plugins/fetch';
export { PerformancePlugin } from './plugins/performance';
export { SSEAutoPlugin } from './plugins/sse-trace';
export type { SSEAutoPluginOptions } from './plugins/sse-trace';
export { OfflineQueuePlugin } from './plugins/offline-queue';
export type { OfflineQueuePluginOptions } from './plugins/offline-queue';
