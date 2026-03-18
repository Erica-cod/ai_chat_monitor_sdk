import type { MonitorPlugin, MonitorInstance } from './types';

/**
 * 插件管理器。
 * 负责注册、按 priority 排序、批量初始化和销毁插件。
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

  getPluginNames(): string[] {
    return this.plugins.map((p) => p.name);
  }
}
