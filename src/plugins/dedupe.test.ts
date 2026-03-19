import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DedupePlugin } from './dedupe';
import type { MonitorEvent, MonitorInstance } from '../core/types';

function makeEvent(type = 'js_error', message = 'test'): MonitorEvent {
  return {
    id: Math.random().toString(),
    type,
    timestamp: Date.now(),
    data: { message },
    context: { appId: 'test', sessionId: 's1', url: '', userAgent: '' },
  };
}

describe('DedupePlugin', () => {
  let plugin: DedupePlugin;

  beforeEach(() => {
    vi.useFakeTimers();
    plugin = new DedupePlugin({ windowMs: 1000 });
    plugin.setup({} as MonitorInstance);
  });

  afterEach(() => {
    plugin.teardown?.();
    vi.useRealTimers();
  });

  it('首次事件正常通过', () => {
    expect(plugin.processEvent!(makeEvent())).not.toBeNull();
  });

  it('窗口内重复事件被去重', () => {
    plugin.processEvent!(makeEvent('js_error', 'same'));
    expect(plugin.processEvent!(makeEvent('js_error', 'same'))).toBeNull();
  });

  it('窗口过后重复事件可以通过', () => {
    plugin.processEvent!(makeEvent('js_error', 'same'));
    vi.advanceTimersByTime(1500);
    expect(plugin.processEvent!(makeEvent('js_error', 'same'))).not.toBeNull();
  });

  it('不同类型的事件不互相去重', () => {
    plugin.processEvent!(makeEvent('js_error', 'msg'));
    expect(plugin.processEvent!(makeEvent('promise_error', 'msg'))).not.toBeNull();
  });
});
