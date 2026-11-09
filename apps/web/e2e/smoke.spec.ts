import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('workspace loads and reaches the API through the same origin', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Platform API online/);
});

test('workspace has no WCAG 2.2 AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(/online/);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

test('web responses carry strict security headers', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('unknown routes fall back to the SPA', async ({ page }) => {
  await page.goto('/does/not/exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
