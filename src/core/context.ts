import type { MonitorContext, MonitorConfig } from './types';
import { uid } from './utils';

/**
 * 全局上下文管理器。
 * 维护 appId、sessionId、userId、当前 URL 等信息，
 * 所有监控事件会自动附带上下文。
 */
export class ContextManager {
  private ctx: MonitorContext;

  constructor(config: Required<MonitorConfig>) {
    this.ctx = {
      appId: config.appId,
      sessionId: this.generateSessionId(),
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      version: config.version,
    };
  }

  get current(): MonitorContext {
    if (typeof location !== 'undefined') {
      this.ctx.url = location.href;
    }
    return { ...this.ctx };
  }

  update(partial: Partial<MonitorContext>): void {
    Object.assign(this.ctx, partial);
  }

  private generateSessionId(): string {
    return uid();
  }
}
