import { createContext, useContext, useEffect, useRef } from 'react';
import { createAIChatMonitor } from '../presets/ai-chat';
import type { AIChatMonitorConfig, MonitorInstance } from '../core/types';

const MonitorContext = createContext<MonitorInstance | null>(null);

interface MonitorProviderProps {
  config: AIChatMonitorConfig;
  children: React.ReactNode;
}

/**
 * React 上下文 Provider，在组件树顶层初始化并共享 Monitor 实例。
 *
 * @example
 * ```tsx
 * <MonitorProvider config={{ appId: 'my-app' }}>
 *   <App />
 * </MonitorProvider>
 * ```
 */
export function MonitorProvider({ config, children }: MonitorProviderProps) {
  const monitorRef = useRef<MonitorInstance | null>(null);

  if (!monitorRef.current) {
    monitorRef.current = createAIChatMonitor(config);
  }

  useEffect(() => {
    return () => {
      monitorRef.current?.destroy();
      monitorRef.current = null;
    };
  }, []);

  return <MonitorContext.Provider value={monitorRef.current}>{children}</MonitorContext.Provider>;
}

/**
 * 获取当前 Monitor 实例。需要在 MonitorProvider 内使用。
 */
export function useMonitor(): MonitorInstance {
  const monitor = useContext(MonitorContext);
  if (!monitor) {
    throw new Error('useMonitor must be used within a <MonitorProvider>');
  }
  return monitor;
}
