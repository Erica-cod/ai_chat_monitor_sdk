import { describe, it, expect, vi } from 'vitest';
import { PluginRunner } from './plugin-runner';
import type { MonitorPlugin, MonitorEvent, MonitorInstance } from './types';

function makeEvent(type = 'test'): MonitorEvent {
  return {
    id: '1',
    type,
    timestamp: Date.now(),
    data: {},
    context: { appId: 'test', sessionId: 's1', url: '', userAgent: '' },
  };
}

function makePlugin(name: string, priority: number, processEvent?: MonitorPlugin['processEvent']): MonitorPlugin {
  return { name, priority, setup: vi.fn(), processEvent };
}

describe('PluginRunner', () => {
  it('按 priority 排序注册插件', () => {
    const runner = new PluginRunner();
    runner.register(makePlugin('c', 50));
    runner.register(makePlugin('a', 10));
    runner.register(makePlugin('b', 30));
    expect(runner.getPluginNames()).toEqual(['a', 'b', 'c']);
  });

  it('去重：相同名称的插件只注册一次', () => {
    const runner = new PluginRunner();
    runner.register(makePlugin('dup', 10));
    runner.register(makePlugin('dup', 20));
    expect(runner.getPluginNames()).toEqual(['dup']);
  });

  it('runProcessEvent 按顺序执行管道', () => {
    const runner = new PluginRunner();
    runner.register(makePlugin('a', 10, (e) => ({ ...e, data: { ...e.data, a: true } })));
    runner.register(makePlugin('b', 20, (e) => ({ ...e, data: { ...e.data, b: true } })));
    const result = runner.runProcessEvent(makeEvent());
    expect(result?.data).toEqual({ a: true, b: true });
  });

  it('返回 null 时终止管道', () => {
    const runner = new PluginRunner();
    runner.register(makePlugin('drop', 10, () => null));
    runner.register(makePlugin('never', 20, (e) => ({ ...e, data: { reached: true } })));
    expect(runner.runProcessEvent(makeEvent())).toBeNull();
  });

  it('返回 false 时终止管道', () => {
    const runner = new PluginRunner();
    runner.register(makePlugin('drop', 10, () => false));
    expect(runner.runProcessEvent(makeEvent())).toBeNull();
  });

  it('单个插件 processEvent 异常不阻断管道', () => {
    const runner = new PluginRunner();
    runner.register(makePlugin('bad', 10, () => { throw new Error('oops'); }));
    runner.register(makePlugin('good', 20, (e) => ({ ...e, data: { ok: true } })));
    const result = runner.runProcessEvent(makeEvent());
    expect(result?.data).toEqual({ ok: true });
  });

  it('setupAll 调用所有插件的 setup', () => {
    const runner = new PluginRunner();
    const p1 = makePlugin('a', 10);
    const p2 = makePlugin('b', 20);
    runner.register(p1);
    runner.register(p2);
    runner.setupAll({} as MonitorInstance);
    expect(p1.setup).toHaveBeenCalledTimes(1);
    expect(p2.setup).toHaveBeenCalledTimes(1);
  });

  it('setupAll 只执行一次', () => {
    const runner = new PluginRunner();
    const p = makePlugin('a', 10);
    runner.register(p);
    runner.setupAll({} as MonitorInstance);
    runner.setupAll({} as MonitorInstance);
    expect(p.setup).toHaveBeenCalledTimes(1);
  });
});
