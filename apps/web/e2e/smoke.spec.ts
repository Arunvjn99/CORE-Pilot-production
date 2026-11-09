import { expect, test } from '@playwright/test';

test('API health is reachable through the same origin', async ({ request }) => {
  const res = await request.get('/api/v1/health/live');
  expect(res.ok()).toBe(true);
  expect(((await res.json()) as { status: string }).status).toBe('ok');
});

test('web responses carry strict security headers', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('unknown routes fall back to the SPA (sign-in when signed out)', async ({ page }) => {
  await page.goto('/does/not/exist');
  await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toBeVisible();
});
