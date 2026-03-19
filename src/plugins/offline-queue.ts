import type { MonitorPlugin, MonitorInstance, MonitorEvent } from '../core/types';
import { isBrowser } from '../core/utils';

export interface OfflineQueuePluginOptions {
  /** IndexedDB 数据库名 */
  dbName?: string;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试间隔（毫秒），默认 10000 */
  retryInterval?: number;
  /** 队列最大容量，默认 500 */
  maxSize?: number;
}

const DB_NAME = 'ai_stream_monitor_offline';
const STORE_NAME = 'events';

/**
 * 离线队列插件。
 * 基于 IndexedDB 实现离线事件缓存，网络恢复后自动重传。
 * 解决弱网环境和页面卸载时的数据丢失问题。
 */
export class OfflineQueuePlugin implements MonitorPlugin {
  readonly name = 'offline-queue';
  readonly priority = 95;

  private options: Required<OfflineQueuePluginOptions>;
  private db: IDBDatabase | null = null;
  private monitor: MonitorInstance | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private onOnline: (() => void) | null = null;

  constructor(options: OfflineQueuePluginOptions = {}) {
    this.options = {
      dbName: options.dbName ?? DB_NAME,
      maxRetries: options.maxRetries ?? 3,
      retryInterval: options.retryInterval ?? 10000,
      maxSize: options.maxSize ?? 500,
    };
  }

  setup(monitor: MonitorInstance): void {
    if (!isBrowser() || typeof indexedDB === 'undefined') return;
    this.monitor = monitor;

    monitor.on('transport:failed', (events: unknown) => {
      if (Array.isArray(events)) {
        this.enqueue(events as MonitorEvent[]);
      }
    });

    this.openDB().then(() => {
      this.retryTimer = setInterval(() => this.flushQueue(), this.options.retryInterval);

      this.onOnline = () => this.flushQueue();
      window.addEventListener('online', this.onOnline);

      this.flushQueue();
    });
  }

  teardown(): void {
    if (this.retryTimer !== null) clearInterval(this.retryTimer);
    if (this.onOnline && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
    }
    this.db?.close();
    this.db = null;
  }

  /** 将上报失败的事件存入离线队列 */
  async enqueue(events: MonitorEvent[]): Promise<void> {
    if (!this.db) return;

    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const event of events) {
      store.put({ ...event, _retries: 0, _queuedAt: Date.now() });
    }
  }

  private async openDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.options.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async flushQueue(): Promise<void> {
    if (!this.db || !this.monitor || !navigator.onLine) return;

    const events = await this.getAllEvents();
    if (events.length === 0) return;

    const batch = events.slice(0, 50);
    const cleanEvents = batch.map((e) => {
      const { _retries, _queuedAt, ...event } = e;
      return event as MonitorEvent;
    });

    try {
      this.monitor.send(cleanEvents);
      await this.removeEvents(batch.map((e) => e.id));
    } catch {
      await this.incrementRetries(batch);
    }
  }

  private getAllEvents(): Promise<(MonitorEvent & { _retries: number; _queuedAt: number })[]> {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);

      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result.filter(
          (e: { _retries: number }) => e._retries < this.options.maxRetries,
        );
        resolve(results);
      };
      request.onerror = () => resolve([]);
    });
  }

  private removeEvents(ids: string[]): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) return resolve();

      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  private incrementRetries(
    events: (MonitorEvent & { _retries: number; _queuedAt: number })[],
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) return resolve();

      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const e of events) {
        store.put({ ...e, _retries: e._retries + 1 });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
