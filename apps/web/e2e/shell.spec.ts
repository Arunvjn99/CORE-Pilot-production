import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminOid, expectAccessible, signIn } from './support';

test.describe.configure({ mode: 'serial' });

test('admin manages a team from the product shell', async ({ browser }) => {
  // A colleague signs in once so they appear in the company directory.
  const colleagueName = `Colleague ${randomUUID().slice(0, 6)}`;
  const colleagueContext = await browser.newContext();
  const colleague = await colleagueContext.newPage();
  await signIn(colleague, {
    oid: randomUUID(),
    name: colleagueName,
    email: `${colleagueName.replace(' ', '.').toLowerCase()}@corp.test`,
  });
  await expect(colleague.getByRole('heading', { name: 'No team yet' })).toBeVisible();

  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();
  await signIn(page, { oid: adminOid, name: 'Company Admin' });
  const teamName = `Shell Team ${randomUUID().slice(0, 6)}`;
  // Company admins can always create another team from the no-team page when they have none; otherwise use the API through the UI flow.
  if (await page.getByLabel('Team name').isVisible()) {
    await page.getByLabel('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create team' }).click();
  }

  // Shell navigation and pages
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  await expectAccessible(page);

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/members$/);
  await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Company Admin/ }).first()).toBeVisible();
  await expectAccessible(page);

  // Add the colleague as a designer
  await page.getByRole('button', { name: 'Add member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a team member' });
  await dialog.getByLabel('Search by name or email').fill(colleagueName);
  await dialog.getByRole('radio', { name: new RegExp(colleagueName) }).check();
  await dialog.getByLabel('Role').selectOption('designer');
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Add to team' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('cell', { name: colleagueName, exact: true })).toBeVisible();

  // Change role, then remove
  await page.getByRole('combobox', { name: `Role for ${colleagueName}` }).selectOption('viewer');
  await expect(page.getByRole('combobox', { name: `Role for ${colleagueName}` })).toHaveValue(
    'viewer',
  );

  // The colleague now has a team: after reload they see the shell, read-only settings.
  await colleague.reload();
  await expect(colleague.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  await colleague
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(colleague.getByRole('button', { name: 'Add member' })).toHaveCount(0);

  await page.getByRole('button', { name: `Remove ${colleagueName}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('cell', { name: colleagueName, exact: true })).toHaveCount(0);

  // Other settings tabs show honest empty states
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'AI providers' })
    .click();
  await expect(page.getByRole('heading', { name: 'Team credentials' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Design systems' })
    .click();
  await expect(page.getByRole('heading', { name: 'No design systems registered' })).toBeVisible();
  await expectAccessible(page);

  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  await colleagueContext.close();
  await adminContext.close();
});

test('the shell works at mobile width', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, { oid: adminOid, name: 'Company Admin' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await expectAccessible(page);
  await context.close();
});
