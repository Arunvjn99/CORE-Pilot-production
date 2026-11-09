import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminOid, expectAccessible, signIn } from './support';

test('sign-in page is accessible and offers Microsoft sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toBeVisible();
  await expectAccessible(page);
});

test('company admin signs in with hardened cookies, reaches projects and signs out', async ({
  page,
  context,
}) => {
  await signIn(page, { oid: adminOid, name: 'Company Admin' });
  const sid = (await context.cookies()).find((c) => c.name === '__Host-core_sid');
  expect(sid?.httpOnly).toBe(true);
  expect(sid?.secure).toBe(true);
  expect(sid?.sameSite).toBe('Lax');

  const createForm = page.getByLabel('Team name');
  if (await createForm.isVisible()) {
    await createForm.fill(`E2E Team ${randomUUID().slice(0, 8)}`);
    await page.getByRole('button', { name: 'Create team' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
  }));
  expect(storage).toEqual({ local: 0, session: 0 });

  await page.getByLabel('Signed in as').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/localhost:8080\/?$|endsession/);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in with Microsoft' })).toBeVisible();
});

test('a signed-in user without a team is told to ask for access', async ({ page }) => {
  await signIn(page, { oid: randomUUID(), name: 'New Starter' });
  await expect(page.getByRole('heading', { name: 'No team yet' })).toBeVisible();
  await expect(page.getByText('not a member of any team')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('identities from another tenant are refused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in with Microsoft' }).click();
  const oid = randomUUID();
  await page.locator('input[name="username"]').fill(oid);
  await page
    .locator('[name="claims"]')
    .fill(JSON.stringify({ oid, tid: randomUUID(), name: 'Outsider' }));
  await page.getByRole('button', { name: 'Sign-in' }).click();
  await expect(page.getByRole('alert')).toHaveText(/Sign-in failed/);
});
