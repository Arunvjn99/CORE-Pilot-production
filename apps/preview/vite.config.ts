import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 8090, strictPort: true, host: '127.0.0.1' },
  // Babel standalone (in-browser TSX compiler) is large by nature; served once and cached.
  build: { target: 'es2023', sourcemap: false, chunkSizeWarningLimit: 4096 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
