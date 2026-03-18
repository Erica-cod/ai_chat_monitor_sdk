/** 监控事件类型 */
export type MonitorEventType =
  | 'js_error'
  | 'promise_error'
  | 'resource_error'
  | 'http_request'
  | 'web_vital'
  | 'sse_start'
  | 'sse_first_chunk'
  | 'sse_phase'
  | 'sse_tool_call'
  | 'sse_stall'
  | 'sse_complete'
  | 'sse_error'
  | 'session_start'
  | 'session_end'
  | 'custom';

/** 监控事件通用结构 */
export interface MonitorEvent {
  id: string;
  type: MonitorEventType;
  timestamp: number;
  data: Record<string, unknown>;
  context: MonitorContext;
}

/** 全局上下文 */
export interface MonitorContext {
  appId: string;
  sessionId: string;
  userId?: string;
  url: string;
  userAgent: string;
  version?: string;
  [key: string]: unknown;
}

/** SDK 配置 */
export interface MonitorConfig {
  /** 应用标识（必填） */
  appId: string;
  /** 上报地址，默认 '/api/monitor' */
  endpoint?: string;
  /** 调试模式，开启后输出 console 日志 */
  debug?: boolean;
  /** 应用版本号 */
  version?: string;
}

/** 插件接口 */
export interface MonitorPlugin {
  /** 插件名称（唯一标识） */
  name: string;
  /**
   * 执行优先级，数字越小越先执行。
   * 推荐范围：采样 10, 去重 20, 会话 30, 业务插件 50, 传输 90, 离线 95
   */
  priority: number;
  /** 插件初始化，接收 Monitor 实例 */
  setup(monitor: MonitorInstance): void;
  /** 插件销毁 */
  teardown?(): void;
}

/** Monitor 实例对外暴露的接口 */
export interface MonitorInstance {
  readonly config: Required<MonitorConfig>;
  readonly context: MonitorContext;

  /** 注册插件 */
  use(plugin: MonitorPlugin): MonitorInstance;
  /** 提交监控事件（经过插件管道处理） */
  emit(event: MonitorEvent): void;
  /** 直接发送到传输层（跳过采样/去重） */
  send(events: MonitorEvent[]): void;
  /** 更新全局上下文 */
  setContext(partial: Partial<MonitorContext>): void;
  /** 创建 SSE 追踪实例 */
  createSSETrace(options: SSETraceOptions): SSETrace;
  /** 订阅内部事件 */
  on(event: string, handler: (...args: unknown[]) => void): void;
  /** 取消订阅 */
  off(event: string, handler: (...args: unknown[]) => void): void;
  /** 销毁 SDK，移除所有监听和插件 */
  destroy(): void;
}

/** SSE 追踪配置 */
export interface SSETraceOptions {
  /** AI 消息 ID（必填，用于关联上下文） */
  messageId: string;
  /** 重试时的前一个 traceId */
  previousTraceId?: string;
  /** 卡顿检测阈值（毫秒），默认 5000 */
  stallThreshold?: number;
}

/** SSE 追踪实例 */
export interface SSETrace {
  readonly traceId: string;
  readonly messageId: string;

  /** SSE 请求开始 */
  start(): void;
  /** 收到首个 chunk → 计算 TTFB */
  onFirstChunk(): void;
  /** 阶段开始/结束（如 thinking, generating） */
  onPhase(phase: string, action: 'start' | 'end'): void;
  /** Tool Calling 开始 */
  onToolCall(toolName: string, params?: Record<string, unknown>): void;
  /** Tool Calling 结束 */
  onToolResult(toolName: string, result?: Record<string, unknown>): void;
  /** SSE 正常完成 → 计算 TTLB */
  complete(meta?: Record<string, unknown>): void;
  /** SSE 异常 */
  error(err: Error | string): void;
  /** 手动中止 */
  abort(): void;
}

/** 传输层接口 */
export interface TransportSendFn {
  (endpoint: string, events: MonitorEvent[]): boolean;
}

/** 预设模式 */
export type PresetMode = 'development' | 'production' | 'minimal';

/** 预设配置（面向用户的简化配置） */
export interface AIChatMonitorConfig extends MonitorConfig {
  /** 预设模式 */
  preset?: PresetMode;
  /** 启用的插件列表（不传则使用预设默认值） */
  plugins?: string[];
  /** 传输配置 */
  transport?: {
    mode?: 'immediate' | 'batch';
    batchSize?: number;
    flushInterval?: number;
    maxRetries?: number;
  };
  /** 采样配置 */
  sampling?: {
    rate?: number;
    alwaysSample?: MonitorEventType[];
  };
  /** 错误监控配置 */
  error?: {
    ignoreErrors?: RegExp[];
    ignoreUrls?: RegExp[];
  };
  /** Fetch 拦截配置 */
  fetch?: {
    includeUrls?: RegExp[];
    excludeUrls?: RegExp[];
  };
  /** 去重窗口（毫秒） */
  dedupeWindow?: number;
}
