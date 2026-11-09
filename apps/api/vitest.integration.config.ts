import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
