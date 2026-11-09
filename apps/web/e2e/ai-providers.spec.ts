import { expect, type Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminOid, completeIdpForm, expectAccessible, signIn } from './support';

/**
 * Full stack: browser → nginx → API (BFF) → AI runtime (service token from the IdP) → provider.
 * The OpenAI check makes a real call with a deliberately invalid key, so it proves the decrypt
 * and egress path without spending money. Set E2E_OLLAMA_URL (as reachable from the ai-runtime
 * container, e.g. http://host.docker.internal:11434) to also run the successful-connection path.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { oid: adminOid, name: 'Company Admin' };
const SCREENSHOTS = '../../docs/screenshots/slice-2.4';
const ollamaUrl = process.env['E2E_OLLAMA_URL'];

async function openProviders(page: Page) {
  await page.goto('/settings/ai-providers');
  if (await page.getByLabel('Team name').isVisible()) {
    await page.getByLabel('Team name').fill(`Providers ${randomUUID().slice(0, 6)}`);
    await page.getByRole('button', { name: 'Create team' }).click();
    await page.goto('/settings/ai-providers');
  }
  await expect(page.getByRole('heading', { name: 'Team credentials' })).toBeVisible();
}

/** Opens the add dialog, completing the step-up redirect through the IdP if required. */
async function openAddDialog(page: Page) {
  await page.getByRole('button', { name: 'Add credential' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('link', { name: 'Confirm identity' });
  if (await confirm.isVisible()) {
    await confirm.click();
    await completeIdpForm(page, ADMIN);
    await expect(page).toHaveURL(/\/settings\/ai-providers$/);
    await page.getByRole('button', { name: 'Add credential' }).click();
  }
  await expect(dialog.getByLabel('Name')).toBeVisible();
  return dialog;
}

test('team manager adds, tests, rotates and revokes a credential', async ({ page }) => {
  await signIn(page, ADMIN);
  await openProviders(page);
  await expectAccessible(page);

  // Step-up is required before the form is shown.
  await page.getByRole('button', { name: 'Add credential' }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Confirm identity' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const label = `OpenAI ${randomUUID().slice(0, 6)}`;
  const fakeKey = `sk-e2e-invalid-${randomUUID().replaceAll('-', '')}`;
  const dialog = await openAddDialog(page);
  await dialog
    .getByRole('radio', { name: /OpenAI/ })
    .first()
    .check();
  await dialog.getByLabel('Name').fill(label);
  await dialog.getByLabel('API key').fill(fakeKey);
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/add-credential-dialog.png` });
  await dialog.getByRole('button', { name: 'Save credential' }).click();
  await expect(dialog).toHaveCount(0);

  const card = page.getByRole('listitem', { name: label });
  await expect(card.getByLabel('Masked key')).toHaveText(`•••• ${fakeKey.slice(-4)}`);
  expect(await page.content()).not.toContain(fakeKey);

  // Real provider call through the runtime: OpenAI rejects the invalid key.
  await card.getByRole('button', { name: `Test connection for ${label}` }).click();
  await expect(card.getByText('Key rejected')).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('The provider rejected the API key')).toBeVisible();

  // Rotate (recent re-authentication still valid).
  await card.getByRole('button', { name: `Rotate key for ${label}` }).click();
  const rotate = page.getByRole('dialog', { name: `Rotate key for ${label}` });
  const rotated = `sk-e2e-rotated-${randomUUID().replaceAll('-', '')}`;
  await rotate.getByLabel('New API key').fill(rotated);
  await rotate.getByRole('button', { name: 'Rotate key' }).click();
  await expect(rotate).toHaveCount(0);
  await expect(card.getByLabel('Masked key')).toHaveText(`•••• ${rotated.slice(-4)}`);

  // Activity feed records the actions without key material.
  const feed = page.getByRole('complementary', { name: 'Defaults and activity' });
  await expect(feed.getByText('tested a connection').first()).toBeVisible();
  await expect(feed.getByText('rotated a key').first()).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOTS}/providers-desktop.png`, fullPage: true });

  // Revoke.
  await card.getByRole('button', { name: `Revoke ${label}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke credential' }).click();
  await expect(page.getByRole('listitem', { name: label })).toHaveCount(0);
  await expect(feed.getByText('revoked a credential').first()).toBeVisible();
  expect(await page.content()).not.toContain(rotated);
});

test('a self-hosted Ollama connects and becomes the default model', async ({ page }) => {
  test.skip(!ollamaUrl, 'E2E_OLLAMA_URL not set');
  await signIn(page, ADMIN);
  await openProviders(page);
  const label = `Ollama ${randomUUID().slice(0, 6)}`;
  const dialog = await openAddDialog(page);
  await dialog.getByRole('radio', { name: /Ollama/ }).check();
  await dialog.getByLabel('Name').fill(label);
  await dialog.getByLabel('Endpoint').fill(ollamaUrl ?? '');
  await dialog.getByRole('button', { name: 'Save credential' }).click();
  await expect(dialog).toHaveCount(0);

  const card = page.getByRole('listitem', { name: label });
  await expect(card.getByLabel('Masked key')).toHaveText('No key');
  await card.getByRole('button', { name: `Test connection for ${label}` }).click();
  await expect(card.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/models? available/)).toBeVisible();

  const defaults = page.getByRole('region', { name: 'Default model' });
  const credentialSelect = defaults.getByLabel('Credential');
  const optionValue = await credentialSelect
    .locator('option', { hasText: label })
    .getAttribute('value');
  await credentialSelect.selectOption(optionValue ?? '');
  await defaults.getByRole('button', { name: 'Load models' }).click();
  const model = defaults.getByLabel('Model');
  await expect(model).toBeVisible({ timeout: 30_000 });
  const chosen = await model.inputValue();
  await defaults.getByRole('button', { name: 'Set as default' }).click();
  const current = defaults.locator('[aria-live="polite"]');
  await expect(current).toContainText(chosen);
  await expect(current).toContainText(`via ${label}`);
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/default-model.png`, fullPage: true });
});

test('provider settings work at mobile width', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  await openProviders(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/providers-mobile.png`, fullPage: true });
  await context.close();
});
