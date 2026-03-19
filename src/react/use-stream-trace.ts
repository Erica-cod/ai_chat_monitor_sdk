import { useRef, useCallback } from 'react';
import { useMonitor } from './provider';
import type { StreamTrace, StreamTraceOptions } from '../core/types';

/**
 * 创建并管理一个流式追踪实例的 Hook。
 * 自动绑定到当前 Monitor，组件卸载时自动中止未完成的追踪。
 *
 * @example
 * ```tsx
 * function ChatMessage({ messageId }: { messageId: string }) {
 *   const { trace, startTrace } = useStreamTrace({ messageId });
 *
 *   const handleStream = async () => {
 *     const t = startTrace();
 *     t.start();
 *
 *     const response = await fetch('/api/chat', { method: 'POST' });
 *     const reader = response.body!.getReader();
 *     let firstChunk = true;
 *
 *     while (true) {
 *       const { done, value } = await reader.read();
 *       if (done) {
 *         t.complete({ completionTokens: 128, model: 'gpt-4o' });
 *         break;
 *       }
 *       if (firstChunk) { t.onFirstChunk(); firstChunk = false; }
 *     }
 *   };
 *
 *   return <button onClick={handleStream}>发送</button>;
 * }
 * ```
 */
export function useStreamTrace(options: Omit<StreamTraceOptions, 'messageId'> & { messageId?: string }) {
  const monitor = useMonitor();
  const traceRef = useRef<StreamTrace | null>(null);

  const startTrace = useCallback(
    (messageId?: string) => {
      if (traceRef.current) {
        traceRef.current.abort();
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

  return {
    trace: traceRef.current,
    startTrace,
  };
}

/** @deprecated 请使用 useStreamTrace */
export const useSSETrace = useStreamTrace;
