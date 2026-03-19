import { useRef, useCallback, useEffect } from 'react';
import { useMonitor } from './provider';
import type { StreamTrace, StreamTraceOptions } from '../core/types';

/**
 * 创建并管理一个流式追踪实例的 Hook。
 * 自动绑定到当前 Monitor，组件卸载时自动中止未完成的追踪。
 *
 * 注意：`startTrace()` 的返回值即为当前 trace 实例，请直接使用返回值操作。
 * 如果 Monitor 不可用（Provider 外或初始化失败），`startTrace()` 返回一个空操作的 noop trace。
 *
 * @example
 * ```tsx
 * function ChatMessage({ messageId }: { messageId: string }) {
 *   const { startTrace } = useStreamTrace({ messageId });
 *
 *   const handleStream = async () => {
 *     const trace = startTrace();
 *     trace.start();
 *
 *     const response = await fetch('/api/chat', { method: 'POST' });
 *     const reader = response.body!.getReader();
 *     let firstChunk = true;
 *
 *     while (true) {
 *       const { done } = await reader.read();
 *       if (done) {
 *         trace.complete({ completionTokens: 128, model: 'gpt-4o' });
 *         break;
 *       }
 *       if (firstChunk) { trace.onFirstChunk(); firstChunk = false; }
 *     }
 *   };
 *
 *   return <button onClick={handleStream}>Send</button>;
 * }
 * ```
 */
export function useStreamTrace(options: Omit<StreamTraceOptions, 'messageId'> & { messageId?: string }) {
  const monitor = useMonitor();
  const traceRef = useRef<StreamTrace | null>(null);

  useEffect(() => {
    return () => {
      traceRef.current?.abort();
      traceRef.current = null;
    };
  }, []);

  const startTrace = useCallback(
    (messageId?: string): StreamTrace => {
      if (traceRef.current) {
        traceRef.current.abort();
      }

      if (!monitor) {
        return NOOP_TRACE;
      }

      const id = messageId ?? options.messageId ?? `msg_${Date.now().toString(36)}`;
      const trace = monitor.createStreamTrace({
        ...options,
        messageId: id,
      });

      traceRef.current = trace;
      return trace;
    },
    [monitor, options],
  );

  return { startTrace };
}

/** @deprecated Use useStreamTrace */
export const useSSETrace = useStreamTrace;

const NOOP_TRACE: StreamTrace = {
  traceId: '',
  messageId: '',
  start() {},
  onFirstChunk() {},
  onPhase() {},
  onToolCall() {},
  onToolResult() {},
  complete() {},
  error() {},
  abort() {},
};
