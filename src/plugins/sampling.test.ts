import { describe, it, expect, vi } from 'vitest';
import { SamplingPlugin } from './sampling';
import type { MonitorEvent, MonitorInstance } from '../core/types';

function makeEvent(type = 'http_request'): MonitorEvent {
  return {
    id: '1',
    type,
    timestamp: Date.now(),
    data: {},
    context: { appId: 'test', sessionId: 's1', url: '', userAgent: '' },
  };
}

describe('SamplingPlugin', () => {
  it('rate=1 时保留所有事件', () => {
    const plugin = new SamplingPlugin({ rate: 1.0 });
    plugin.setup({} as MonitorInstance);
    expect(plugin.processEvent!(makeEvent())).not.toBeNull();
  });

  it('rate=0 时丢弃普通事件', () => {
    const plugin = new SamplingPlugin({ rate: 0 });
    plugin.setup({} as MonitorInstance);
    expect(plugin.processEvent!(makeEvent())).toBeNull();
  });

  it('alwaysSample 的事件即使 rate=0 也保留', () => {
    const plugin = new SamplingPlugin({
      rate: 0,
      alwaysSample: ['js_error'],
    });
    plugin.setup({} as MonitorInstance);
    expect(plugin.processEvent!(makeEvent('js_error'))).not.toBeNull();
  });
});
