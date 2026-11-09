import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Same-origin API in every environment: Vite proxy in dev, nginx in the container. No API URL baked into the bundle.
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:3000' } },
  build: { sourcemap: true, target: 'es2023' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});
