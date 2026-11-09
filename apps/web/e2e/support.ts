import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const tenantId = process.env['E2E_TENANT_ID'] ?? '';
export const adminOid = process.env['E2E_ADMIN_OID'] ?? '';
if (!tenantId || !adminOid)
  throw new Error('E2E_TENANT_ID and E2E_ADMIN_OID are required (see scripts/test-e2e.sh)');

/** Completes the real OIDC flow through the local test IdP's sign-in form. */
export async function signIn(page: Page, identity: { oid: string; name: string; email?: string }) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
  await page.locator('input[name="username"]').fill(identity.oid);
  await page.locator('[name="claims"]').fill(
    JSON.stringify({
      oid: identity.oid,
      tid: tenantId,
      name: identity.name,
      email: identity.email,
    }),
  );
  await page.getByRole('button', { name: 'Sign-in' }).click();
  await expect(page.getByLabel('Signed in as')).toHaveText(identity.name);
}

export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}
