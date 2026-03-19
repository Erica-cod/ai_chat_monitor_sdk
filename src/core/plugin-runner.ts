import type { MonitorPlugin, MonitorInstance, MonitorEvent } from './types';

/**
 * 插件管理器。
 * 负责注册、按 priority 排序、批量初始化/销毁插件，以及运行事件管道。
 */
export class PluginRunner {
  private plugins: MonitorPlugin[] = [];
  private initialized = false;

  register(plugin: MonitorPlugin): void {
    const exists = this.plugins.some((p) => p.name === plugin.name);
    if (exists) return;

    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  setupAll(monitor: MonitorInstance): void {
    if (this.initialized) return;
    this.initialized = true;

    for (const plugin of this.plugins) {
      try {
        plugin.setup(monitor);
      } catch {
        // 单个插件初始化失败不影响其他插件
      }
    }
  }

  teardownAll(): void {
    for (const plugin of [...this.plugins].reverse()) {
      try {
        plugin.teardown?.();
      } catch {
        // 静默处理
      }
    }
    this.plugins = [];
    this.initialized = false;
  }

  /**
   * 按 priority 顺序依次调用插件的 processEvent 钩子。
   * 任意插件返回 null/false 即终止管道；返回修改后的 event 则继续传递。
   */
  runProcessEvent(event: MonitorEvent): MonitorEvent | null {
    let current: MonitorEvent | null = event;

    for (const plugin of this.plugins) {
      if (!current) return null;
      if (plugin.processEvent) {
        try {
          const result = plugin.processEvent(current);
          if (result === null || result === false) return null;
          current = result;
        } catch {
          // 单个钩子异常不阻断管道
        }
      }
    }

    return current;
  }

  getPluginNames(): string[] {
    return this.plugins.map((p) => p.name);
  }
}
