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
 * 遵循 "SDK 永不崩溃宿主应用" 原则：
 * - 初始化失败时降级为 null，不会导致 React 树崩溃
 * - 子组件可通过 useMonitor() 安全获取实例
 *
 * 注意：Monitor 实例仅在首次渲染时创建，后续 config 变更不会触发重建。
 * 这是有意为之——监控实例应保持稳定，避免频繁重建导致数据丢失。
 * 如需更新运行时配置（如 userId），请使用 `monitor.setContext()`。
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
    try {
      monitorRef.current = createAIChatMonitor(config);
    } catch (err) {
      if (config.debug) {
        console.error('[ai-stream-monitor] Failed to initialize:', err);
      }
    }
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
 * 获取当前 Monitor 实例。
 *
 * 在 MonitorProvider 外调用或初始化失败时返回 null，不会抛异常。
 * 符合监控 SDK "永不影响宿主应用" 的设计原则。
 */
export function useMonitor(): MonitorInstance | null {
  return useContext(MonitorContext);
}
