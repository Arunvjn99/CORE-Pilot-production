import { defineConfig, devices } from '@playwright/test';

// E2E runs against the composed stack (same images as production). Base URL comes from env.
const baseURL = process.env['E2E_BASE_URL'];
if (!baseURL) throw new Error('E2E_BASE_URL is required (e.g. http://localhost:8080)');

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
