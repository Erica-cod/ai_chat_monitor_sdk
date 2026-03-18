import type { MonitorPlugin, MonitorInstance } from '../core/types';
import { isBrowser } from '../core/utils';

const SESSION_KEY = 'ai_stream_monitor_session';
const SESSION_TTL = 30 * 60 * 1000; // 30 分钟无操作则过期

interface StoredSession {
  id: string;
  lastActive: number;
}

/**
 * 会话管理插件。
 * 生成并维护 sessionId，存储在 sessionStorage 中。
 * 30 分钟无活动自动过期，生成新会话。
 */
export class SessionPlugin implements MonitorPlugin {
  readonly name = 'session';
  readonly priority = 30;

  setup(monitor: MonitorInstance): void {
    if (!isBrowser()) return;

    const sessionId = this.getOrCreateSession();
    monitor.setContext({ sessionId });

    monitor.on('event', () => {
      this.touch();
    });
  }

  private getOrCreateSession(): string {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const session: StoredSession = JSON.parse(raw);
        if (Date.now() - session.lastActive < SESSION_TTL) {
          this.touch();
          return session.id;
        }
      }
    } catch {
      // sessionStorage 不可用时静默
    }

    const newId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.save(newId);
    return newId;
  }

  private touch(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const session: StoredSession = JSON.parse(raw);
        session.lastActive = Date.now();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
    } catch {
      // 静默
    }
  }

  private save(id: string): void {
    try {
      const session: StoredSession = { id, lastActive: Date.now() };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // 静默
    }
  }
}
