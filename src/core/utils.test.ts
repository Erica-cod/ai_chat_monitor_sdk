import { describe, it, expect } from 'vitest';
import { uid, now, safeRun, isBrowser, isNode } from './utils';

describe('uid()', () => {
  it('返回非空字符串', () => {
    expect(uid()).toBeTruthy();
    expect(typeof uid()).toBe('string');
  });

  it('每次调用返回唯一值', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

describe('now()', () => {
  it('返回毫秒级时间戳', () => {
    const t = now();
    expect(t).toBeGreaterThan(1700000000000);
    expect(Number.isInteger(t)).toBe(true);
  });

  it('单调递增', () => {
    const t1 = now();
    const t2 = now();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});

describe('safeRun()', () => {
  it('正常函数返回结果', () => {
    expect(safeRun(() => 42)).toBe(42);
  });

  it('异常时返回 fallback', () => {
    expect(safeRun(() => { throw new Error('boom'); }, 'default')).toBe('default');
  });

  it('异常且无 fallback 时返回 undefined', () => {
    expect(safeRun(() => { throw new Error('boom'); })).toBeUndefined();
  });
});

describe('环境检测', () => {
  it('isBrowser() 在 jsdom 中返回 true', () => {
    expect(isBrowser()).toBe(true);
  });

  it('isNode() 返回布尔值', () => {
    expect(typeof isNode()).toBe('boolean');
  });
});
