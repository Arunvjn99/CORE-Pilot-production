import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/unit/**/*.test.ts'], environment: 'node', testTimeout: 20_000 },
  // SWC emits decorator metadata, which esbuild does not; required for NestJS DI.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
