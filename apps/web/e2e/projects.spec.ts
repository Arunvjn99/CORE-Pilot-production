import { expect, type Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminOid, expectAccessible, signIn } from './support';

/** Figma-style flow (ADR-0014): Team → Projects → Files → Screens. */
test.describe.configure({ mode: 'serial' });

const ADMIN = { oid: adminOid, name: 'Company Admin' };
const SCREENSHOTS = '../../docs/screenshots/v2';
const suffix = randomUUID().slice(0, 6);
const projectName = `Checkout ${suffix}`;
const fileName = `Web store ${suffix}`;
let projectUrl = '';

async function ensureTeam(page: Page) {
  if (await page.getByLabel('Team name').isVisible()) {
    await page.getByLabel('Team name').fill(`Files ${randomUUID().slice(0, 6)}`);
    await page.getByRole('button', { name: 'Create team' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Recents', level: 1 })).toBeVisible();
}

const files = (page: Page) => page.getByRole('navigation', { name: 'Files navigation' });
const card = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true });
async function fileMenu(page: Page, name: string, item: string) {
  await card(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('acceptance: project → new design file → screens, persisted', async ({ page }) => {
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await expectAccessible(page);

  // New project (folder) from the sidebar
  await files(page).getByRole('button', { name: 'New project' }).click();
  const newProject = page.getByRole('dialog', { name: 'New project' });
  await newProject.getByLabel('Project name').fill(projectName);
  await newProject.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/files\/project\/[0-9a-f-]{36}$/);
  projectUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
  await expect(page.getByText(`No files in ${projectName}`)).toBeVisible();
  await expectAccessible(page);

  // New design file in this project → editor
  await page.getByRole('button', { name: 'New design file' }).click();
  const newFile = page.getByRole('dialog', { name: 'New design file' });
  await newFile.getByLabel('File name').fill(fileName);
  await expect(newFile.getByLabel('Project')).toHaveValue(projectUrl.split('/').pop() ?? '');
  await expect(newFile.getByLabel('Design system')).toHaveValue('core-2');
  await expectAccessible(page);
  await newFile.getByRole('button', { name: 'Create file' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: fileName, level: 1 })).toBeVisible();

  // Screens: add, navigate, rename, delete (Pages tab)
  await page.getByRole('tab', { name: 'Pages' }).click();
  const sidebar = page.getByRole('complementary', { name: 'Assistant and pages' });
  await expect(sidebar.getByRole('link', { name: /Home/ })).toBeVisible();
  for (const name of ['Cart', 'Payment Details']) {
    await sidebar.getByRole('button', { name: 'Add page' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add page' });
    await dialog.getByLabel('Page name').fill(name);
    await dialog.getByRole('button', { name: 'Add page' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.getByRole('region', { name: /^Screen \d+: Cart$/ })).toBeVisible();
  await sidebar.getByRole('link', { name: /Cart/ }).click();
  await expect(sidebar.getByRole('link', { name: /Cart/ })).toHaveAttribute('aria-current', 'page');
  await sidebar.getByRole('link', { name: /Cart/ }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sidebar.getByRole('link', { name: /Payment Details/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sidebar.getByRole('button', { name: 'Actions for page Payment Details' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename page' });
  await rename.getByLabel('Page name').fill('Payment');
  await rename.getByLabel('Route').fill('/payment');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(sidebar.getByRole('link', { name: /Payment.*\/payment$/ })).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/workspace-light.png` });
  await sidebar.getByRole('button', { name: 'Actions for page Cart' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog', { name: 'Delete page “Cart”?' })
    .getByRole('button', { name: 'Delete page' })
    .click();
  await expect(sidebar.getByRole('link', { name: /Cart/ })).toHaveCount(0);

  // Back in the browser: the file shows in its project and in Recents, not in Drafts
  await page.goto(projectUrl);
  await expect(card(page, fileName)).toContainText('2 screens');
  await page.screenshot({ path: `${SCREENSHOTS}/files-project-light.png`, fullPage: true });
  await files(page).getByRole('link', { name: 'Recents' }).click();
  await expect(card(page, fileName)).toContainText(projectName);
  await files(page).getByRole('link', { name: 'Drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Drafts', level: 1 })).toBeVisible();
  await expect(card(page, fileName)).toHaveCount(0);
});

test('file CRUD: rename, duplicate, move, trash with undo, restore; delete a project', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await page.goto(projectUrl);
  const renamed = `${fileName} v2`;

  await fileMenu(page, fileName, 'Rename');
  const rename = page.getByRole('dialog', { name: 'Rename file' });
  await rename.getByLabel('File name').fill(renamed);
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(card(page, renamed)).toBeVisible();

  await fileMenu(page, renamed, 'Duplicate');
  await expect(page.getByText(`Duplicated as “${renamed} (copy)”.`)).toBeVisible();
  await expect(card(page, `${renamed} (copy)`)).toContainText('2 screens');

  await fileMenu(page, `${renamed} (copy)`, 'Move to…');
  const move = page.getByRole('dialog', { name: `Move “${renamed} (copy)”` });
  await move.getByLabel('Project').selectOption({ label: 'Drafts' });
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(card(page, `${renamed} (copy)`)).toHaveCount(0);
  await files(page).getByRole('link', { name: 'Drafts' }).click();
  await expect(card(page, `${renamed} (copy)`)).toBeVisible();

  // Trash with Undo, then for real, then restore from Trash
  await fileMenu(page, `${renamed} (copy)`, 'Move to trash');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, `${renamed} (copy)`)).toBeVisible();
  await fileMenu(page, `${renamed} (copy)`, 'Move to trash');
  await expect(card(page, `${renamed} (copy)`)).toHaveCount(0);
  await files(page).getByRole('link', { name: 'Trash' }).click();
  await expect(card(page, `${renamed} (copy)`)).toBeVisible();
  await expectAccessible(page);
  await fileMenu(page, `${renamed} (copy)`, 'Restore');
  await expect(card(page, `${renamed} (copy)`)).toHaveCount(0);

  // Deleting the project moves its file to Trash
  await files(page)
    .getByRole('button', { name: `Actions for project ${projectName}` })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: `Delete project “${projectName}”?` });
  await expect(confirm).toContainText('Its 1 file moves to Trash');
  await expectAccessible(page);
  await confirm.getByRole('button', { name: 'Delete project' }).click();
  await expect(page).toHaveURL(/\/files\/trash$/);
  await expect(card(page, renamed)).toBeVisible();
  await expect(files(page).getByRole('link', { name: new RegExp(projectName) })).toHaveCount(0);
  await page.screenshot({ path: `${SCREENSHOTS}/files-trash-light.png`, fullPage: true });
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
  await page.getByRole('list', { name: 'Recents files' }).getByRole('link').first().click();
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

test('dark file browser and editor on desktop', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await page.screenshot({ path: `${SCREENSHOTS}/files-recents-dark.png`, fullPage: true });
  await page.getByRole('list', { name: 'Recents files' }).getByRole('link').first().click();
  await expect(page.getByRole('complementary', { name: 'Assistant and pages' })).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/workspace-dark-desktop.png` });
  await context.close();
});
