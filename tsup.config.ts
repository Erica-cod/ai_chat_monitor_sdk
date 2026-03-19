import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
    'plugins/error': 'src/plugins/error.ts',
    'plugins/performance': 'src/plugins/performance.ts',
    'plugins/sse-trace': 'src/plugins/sse-trace.ts',
    'plugins/fetch': 'src/plugins/fetch.ts',
    'plugins/session': 'src/plugins/session.ts',
    'plugins/sampling': 'src/plugins/sampling.ts',
    'plugins/dedupe': 'src/plugins/dedupe.ts',
    'plugins/transport': 'src/plugins/transport.ts',
    'plugins/offline-queue': 'src/plugins/offline-queue.ts',
    'plugins/websocket': 'src/plugins/websocket.ts',
    parsers: 'src/parsers/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  target: 'es2020',
  outDir: 'dist',
  external: ['react'],
});
