import { uid, now } from './utils';
import type {
  MonitorInstance,
  StreamTrace,
  StreamTraceOptions,
  StreamResult,
} from './types';

/**
 * 流式追踪实例。
 * 追踪一次 AI 流式响应的完整生命周期，支持 TTFT、TTLB、TPS、token 统计。
 */
export class StreamTraceImpl implements StreamTrace {
  readonly traceId: string;
  readonly messageId: string;

  private monitor: MonitorInstance;
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

  constructor(monitor: MonitorInstance, options: StreamTraceOptions) {
    this.monitor = monitor;
    this.traceId = uid();
    this.messageId = options.messageId;
    this.model = options.model;
    this.provider = options.provider;
    this.stallThreshold = options.stallThreshold ?? 5000;
    this.previousTraceId = options.previousTraceId;
  }

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
