/** 内置监控事件类型 */
export type BuiltinEventType =
  | 'js_error'
  | 'promise_error'
  | 'http_request'
  | 'web_vital'
  | 'stream_start'
  | 'stream_first_token'
  | 'stream_phase'
  | 'stream_tool_call'
  | 'stream_stall'
  | 'stream_complete'
  | 'stream_error'
  | 'session_start'
  | 'session_end'
  | 'custom';

/**
 * 监控事件类型。
 * 包含所有内置类型，同时允许自定义扩展（如 `'my_plugin_event'`）。
 */
export type MonitorEventType = BuiltinEventType | (string & {});

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
  /**
   * 事件管道钩子，按 priority 顺序依次调用。
   * - 返回修改后的 MonitorEvent → 事件继续流经后续插件
   * - 返回 null / false → 丢弃事件（用于采样、去重）
   *
   * 类似 Sentry 的 `processEvent`。
   */
  processEvent?(event: MonitorEvent): MonitorEvent | null | false;
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
  /** 创建流式追踪实例 */
  createStreamTrace(options: StreamTraceOptions): StreamTrace;
  /**
   * @deprecated 请使用 createStreamTrace()
   */
  createSSETrace(options: StreamTraceOptions): StreamTrace;
  /** 订阅内部事件 */
  on(event: string, handler: (...args: unknown[]) => void): void;
  /** 取消订阅 */
  off(event: string, handler: (...args: unknown[]) => void): void;
  /** 发射内部信号（不经过 processEvent 管道，用于插件间通信） */
  signal(name: string, data?: unknown): void;
  /** 销毁 SDK，移除所有监听和插件 */
  destroy(): void;
}

/** 流式追踪配置 */
export interface StreamTraceOptions {
  /** AI 消息 ID（必填，用于关联上下文） */
  messageId: string;
  /** 模型名称（如 gpt-4o, doubao-pro） */
  model?: string;
  /** 模型供应商（如 openai, bytedance） */
  provider?: string;
  /** 重试时的前一个 traceId */
  previousTraceId?: string;
  /** 卡顿检测阈值（毫秒），默认 5000 */
  stallThreshold?: number;
}

/** 流式响应的结果摘要 */
export interface StreamResult {
  /** 输入 token 数 */
  promptTokens?: number;
  /** 输出 token 数 */
  completionTokens?: number;
  /** 总 token 数（不传则自动计算 promptTokens + completionTokens） */
  totalTokens?: number;
  /** 模型名称（覆盖 options 中的值） */
  model?: string;
  /** 允许附加自定义字段 */
  [key: string]: unknown;
}

/** 流式追踪实例 */
export interface StreamTrace {
  readonly traceId: string;
  readonly messageId: string;

  /** 流式请求开始 */
  start(): void;
  /** 收到首个 token → 计算 TTFT */
  onFirstChunk(): void;
  /** 阶段开始/结束（如 thinking, generating） */
  onPhase(phase: string, action: 'start' | 'end'): void;
  /** Tool Calling 开始 */
  onToolCall(toolName: string, params?: Record<string, unknown>): void;
  /** Tool Calling 结束 */
  onToolResult(toolName: string, result?: Record<string, unknown>): void;
  /** 流式正常完成 → 计算 TTLB / TPS */
  complete(result?: StreamResult): void;
  /** 流式异常 */
  error(err: Error | string): void;
  /** 手动中止 */
  abort(): void;
}

/** @deprecated 请使用 StreamTraceOptions */
export type SSETraceOptions = StreamTraceOptions;
/** @deprecated 请使用 StreamTrace */
export type SSETrace = StreamTrace;

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
    /** 自定义上报函数，传入则跳过内置的 sendBeacon/fetch */
    customSend?: (endpoint: string, payload: string) => void;
  };
  /** 采样配置 */
  sampling?: {
    rate?: number;
    alwaysSample?: MonitorEventType[];
  };
  /** 错误监控配置 */
  error?: {
    /** 是否启用错误监控，默认 true */
    enabled?: boolean;
    ignoreErrors?: RegExp[];
    ignoreUrls?: RegExp[];
  };
  /**
   * Fetch 拦截配置。
   * 注意：启用后会劫持全局 fetch，可能影响 OIDC 登录等依赖原生 fetch 的流程。
   * 默认不启用，需显式传入 streamPatterns 或设置 enabled: true。
   */
  fetch?: {
    /** 是否启用 Fetch 拦截，默认 false（传入 streamPatterns 时自动启用） */
    enabled?: boolean;
    includeUrls?: RegExp[];
    excludeUrls?: RegExp[];
    /** 匹配的 URL 会被视为 AI 流式端点，自动创建 StreamTrace */
    streamPatterns?: RegExp[];
  };
  /** 去重窗口（毫秒） */
  dedupeWindow?: number;
  /**
   * 事件上报前的全局钩子（类似 Sentry 的 beforeSend）。
   * 可用于数据脱敏、过滤、增强。返回 null 则丢弃该事件。
   */
  beforeSend?: (event: MonitorEvent) => MonitorEvent | null;
}
