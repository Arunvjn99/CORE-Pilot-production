import { expect, type Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminOid, expectAccessible, signIn } from './support';

test.describe.configure({ mode: 'serial' });

const ADMIN = { oid: adminOid, name: 'Company Admin' };
const SCREENSHOTS = '../../docs/screenshots/v2';

async function ensureTeam(page: Page) {
  if (await page.getByLabel('Team name').isVisible()) {
    await page.getByLabel('Team name').fill(`Projects ${randomUUID().slice(0, 6)}`);
    await page.getByRole('button', { name: 'Create team' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
}

const projectName = `Checkout ${randomUUID().slice(0, 6)}`;

test('acceptance: create a project, add pages, navigate and reopen with data persisted', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await expectAccessible(page);

  // Create
  await page.getByRole('button', { name: 'New project' }).click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await create.getByLabel('Project name').fill(projectName);
  await create.getByLabel('Description').fill('Redesigned checkout for the web store');
  await expectAccessible(page);
  await create.getByRole('button', { name: 'Create project' }).click();

  // Enter the studio; pages are managed in its Pages tab.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Pages' }).click();
  const sidebar = page.getByRole('complementary', { name: 'Assistant and pages' });
  await expect(sidebar.getByRole('link', { name: /Home/ })).toBeVisible();

  // Create pages
  for (const name of ['Cart', 'Payment Details']) {
    await sidebar.getByRole('button', { name: 'Add page' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add page' });
    await dialog.getByLabel('Page name').fill(name);
    await dialog.getByRole('button', { name: 'Add page' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(
    sidebar.getByRole('link', { name: /Payment Details.*\/payment-details/ }),
  ).toBeVisible();
  // Each page is a screen on the canvas.
  await expect(page.getByRole('region', { name: /^Screen \d+: Cart$/ })).toBeVisible();

  // Navigate between pages (mouse and keyboard)
  await sidebar.getByRole('link', { name: /Cart/ }).click();
  await expect(page).toHaveURL(/\?page=/);
  await expect(sidebar.getByRole('link', { name: /Cart/ })).toHaveAttribute('aria-current', 'page');
  await sidebar.getByRole('link', { name: /Cart/ }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sidebar.getByRole('link', { name: /Payment Details/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Rename a page
  await sidebar.getByRole('button', { name: 'Actions for page Payment Details' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename page' });
  await rename.getByLabel('Page name').fill('Payment');
  await rename.getByLabel('Route').fill('/payment');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(sidebar.getByRole('link', { name: /Payment.*\/payment$/ })).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/workspace-light.png` });

  // Delete a page with confirmation
  await sidebar.getByRole('button', { name: 'Actions for page Cart' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete page “Cart”?' });
  await expectAccessible(page);
  await confirm.getByRole('button', { name: 'Delete page' }).click();
  await expect(sidebar.getByRole('link', { name: /Cart/ })).toHaveCount(0);

  // Reopen: data persisted on the server
  await page.goto('/projects');
  const card = page.getByRole('listitem', { name: projectName });
  await expect(card.getByText('2 pages')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently opened' })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOTS}/dashboard-light.png`, fullPage: true });
  await card.getByRole('link', { name: projectName }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Pages' }).click();
  const reopened = page.getByRole('complementary', { name: 'Assistant and pages' });
  await expect(reopened.getByRole('link', { name: /Home/ })).toBeVisible();
  await expect(reopened.getByRole('link', { name: /Payment.*\/payment$/ })).toBeVisible();
  await expect(reopened.getByRole('link', { name: /Cart/ })).toHaveCount(0);
});

test('rename and archive from the dashboard, then restore', async ({ page }) => {
  await signIn(page, ADMIN);
  await ensureTeam(page);
  const card = page.getByRole('listitem', { name: projectName });
  await card.getByRole('button', { name: `Actions for ${projectName}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename project' });
  const renamed = `${projectName} v2`;
  await dialog.getByLabel('Project name').fill(renamed);
  await dialog.getByRole('button', { name: 'Save' }).click();
  const renamedCard = page.getByRole('listitem', { name: renamed });
  await expect(renamedCard).toBeVisible();

  await renamedCard.getByRole('button', { name: `Actions for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(renamedCard).toHaveCount(0);
  await page.getByRole('tab', { name: /Archived/ }).click();
  const archivedCard = page.getByRole('listitem', { name: renamed });
  await expect(archivedCard.getByText('Archived')).toBeVisible();
  await expectAccessible(page);
  await archivedCard.getByRole('button', { name: `Actions for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(archivedCard).toHaveCount(0);
});

test('dark theme and tablet layout', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await page
    .getByRole('button', { name: /Signed in as|Company Admin/ })
    .first()
    .click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/dashboard-dark-tablet.png`, fullPage: true });

  // Theme survives a reload; the studio fits a tablet without horizontal scrolling.
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Active' })
    .first()
    .getByRole('link')
    .first()
    .click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('complementary', { name: 'Assistant and pages' })).toBeVisible();
  await expectAccessible(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: `${SCREENSHOTS}/workspace-dark-tablet.png` });
  await context.close();
});

test('dark workspace on desktop', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Active' })
    .first()
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByRole('complementary', { name: 'Assistant and pages' })).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/workspace-dark-desktop.png` });
  await context.close();
});
