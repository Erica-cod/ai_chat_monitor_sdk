import type { MonitorPlugin, MonitorInstance } from '../core/types';
import { isBrowser } from '../core/utils';

const SESSION_KEY = 'ai_stream_monitor_session';
const SESSION_TTL = 30 * 60 * 1000; // 30 分钟无操作则过期

interface StoredSession {
  id: string;
  lastActive: number;
}

/** 内存级 fallback，用于 Node.js / Web Worker 等无 sessionStorage 的环境 */
const memoryStore = new Map<string, string>();

/**
 * 会话管理插件。
 * 优先使用 sessionStorage；不可用时自动 fallback 到内存 Map。
 * 30 分钟无活动自动过期，生成新会话。
 */
export class SessionPlugin implements MonitorPlugin {
  readonly name = 'session';
  readonly priority = 30;

  setup(monitor: MonitorInstance): void {
    const sessionId = this.getOrCreateSession();
    monitor.setContext({ sessionId });

    monitor.on('event', () => {
      this.touch();
    });
  }

  private getOrCreateSession(): string {
    if (this.hasSessionStorage()) {
      return this.getFromSessionStorage();
    }
    return this.getFromMemory();
  }

  private getFromSessionStorage(): string {
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
      // sessionStorage 异常时 fallback
    }

    const newId = this.generateId();
    this.saveToSessionStorage(newId);
    return newId;
  }

  private getFromMemory(): string {
    const raw = memoryStore.get(SESSION_KEY);
    if (raw) {
      try {
        const session: StoredSession = JSON.parse(raw);
        if (Date.now() - session.lastActive < SESSION_TTL) {
          this.touch();
          return session.id;
        }
      } catch {
        // 解析失败，创建新 session
      }
    }

    const newId = this.generateId();
    this.saveToMemory(newId);
    return newId;
  }

  private touch(): void {
    if (this.hasSessionStorage()) {
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
    } else {
      const raw = memoryStore.get(SESSION_KEY);
      if (raw) {
        try {
          const session: StoredSession = JSON.parse(raw);
          session.lastActive = Date.now();
          memoryStore.set(SESSION_KEY, JSON.stringify(session));
        } catch {
          // 静默
        }
      }
    }
  }

  private saveToSessionStorage(id: string): void {
    try {
      const session: StoredSession = { id, lastActive: Date.now() };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // 静默，fallback 到内存
      this.saveToMemory(id);
    }
  }

  private saveToMemory(id: string): void {
    const session: StoredSession = { id, lastActive: Date.now() };
    memoryStore.set(SESSION_KEY, JSON.stringify(session));
  }

  private hasSessionStorage(): boolean {
    if (!isBrowser()) return false;
    try {
      const key = '__asm_test__';
      sessionStorage.setItem(key, '1');
      sessionStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  private generateId(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
