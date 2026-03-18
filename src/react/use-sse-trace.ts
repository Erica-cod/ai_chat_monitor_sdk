import { useRef, useCallback } from 'react';
import { useMonitor } from './provider';
import type { SSETrace, SSETraceOptions } from '../core/types';

/**
 * 创建并管理一个 SSE 追踪实例的 Hook。
 * 自动绑定到当前 Monitor，组件卸载时自动中止未完成的追踪。
 *
 * @example
 * ```tsx
 * function ChatMessage({ messageId }: { messageId: string }) {
 *   const { trace, startTrace } = useSSETrace({ messageId });
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
 *       if (done) { t.complete(); break; }
 *       if (firstChunk) { t.onFirstChunk(); firstChunk = false; }
 *     }
 *   };
 *
 *   return <button onClick={handleStream}>发送</button>;
 * }
 * ```
 */
export function useSSETrace(options: Omit<SSETraceOptions, 'messageId'> & { messageId?: string }) {
  const monitor = useMonitor();
  const traceRef = useRef<SSETrace | null>(null);

  const startTrace = useCallback(
    (messageId?: string) => {
      // 中止上一个未完成的追踪
      if (traceRef.current) {
        traceRef.current.abort();
      }

      const id = messageId ?? options.messageId ?? `msg_${Date.now().toString(36)}`;
      const trace = monitor.createSSETrace({
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
