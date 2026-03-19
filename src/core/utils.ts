/**
 * 生成唯一 ID。
 * 优先使用 crypto.randomUUID()，依次降级到 crypto.getRandomValues()、Math.random()。
 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

/** 获取高精度时间戳（毫秒） */
export function now(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return Math.round(performance.timeOrigin + performance.now());
  }
  return Date.now();
}

/** 安全执行函数，异常时静默 */
export function safeRun<T>(fn: () => T, fallback?: T): T | undefined {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** 判断是否在浏览器环境 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** 判断是否在 Node.js 环境 */
export function isNode(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null
  );
}
