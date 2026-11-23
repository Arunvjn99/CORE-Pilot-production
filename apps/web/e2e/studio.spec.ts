import { expect, type Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MODEL, startFakeLlm } from './fake-llm';
import { readZip } from './zip';
import { adminOid, completeIdpForm, expectAccessible, signIn } from './support';

/**
 * Studio journey on the composed stack: configure the team key and default model, create a project,
 * prompt the agent team, follow the live run, see the screens render on the separate preview
 * origin, edit an element visually (written back to source), play the prototype, read metrics.
 *
 * The model is an Ollama-compatible fake on this machine (see fake-llm.ts); the stack must allow it:
 * LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS=host.docker.internal in .env.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { oid: adminOid, name: 'Company Admin' };
const SCREENSHOTS = '../../docs/screenshots/v2';
const allowed = (process.env['LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS'] ?? '').split(',');
const projectName = `Retirement ${randomUUID().slice(0, 6)}`;

let llm: Awaited<ReturnType<typeof startFakeLlm>> | undefined;

test.beforeAll(async () => {
  if (allowed.includes('host.docker.internal')) llm = await startFakeLlm();
});
test.afterAll(async () => {
  await llm?.close();
});
test.beforeEach(() => {
  test.skip(!llm, 'Set LLM_ENDPOINT_ALLOWED_PRIVATE_HOSTS=host.docker.internal for the studio E2E');
});

/**
 * Clicks an element inside a zoomed preview iframe at its real on-screen position. Playwright's own
 * locator click ignores the canvas zoom transform on cross-site iframes and would miss.
 */
async function clickOnCanvas(page: Page, frameTitle: string, selector: string) {
  const iframe = page.locator(`iframe[title="${frameTitle}"]`);
  const outer = await iframe.boundingBox();
  const frame = await (await iframe.elementHandle()).contentFrame();
  if (!outer || !frame) throw new Error(`frame ${frameTitle} not found`);
  const inner = await frame.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: window.innerWidth };
  }, selector);
  if (!inner) throw new Error(`${selector} not found in ${frameTitle}`);
  const scale = outer.width / inner.width;
  await page.mouse.click(outer.x + inner.x * scale, outer.y + inner.y * scale);
}

async function ensureTeam(page: Page) {
  if (await page.getByLabel('Team name').isVisible()) {
    await page.getByLabel('Team name').fill(`Studio ${randomUUID().slice(0, 6)}`);
    await page.getByRole('button', { name: 'Create team' }).click();
  }
}

test('team owner connects the model the agents use', async ({ page }) => {
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await page.goto('/settings/ai-providers');
  await expect(page.getByRole('heading', { name: 'Team credentials' })).toBeVisible();

  const label = `Studio model ${randomUUID().slice(0, 6)}`;
  await page.getByRole('button', { name: 'Add credential' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('link', { name: 'Confirm identity' });
  if (await confirm.isVisible()) {
    await confirm.click();
    await completeIdpForm(page, ADMIN);
    await expect(page).toHaveURL(/\/settings\/ai-providers$/);
    await page.getByRole('button', { name: 'Add credential' }).click();
  }
  await dialog.getByRole('radio', { name: /Ollama/ }).check();
  await dialog.getByLabel('Name').fill(label);
  await dialog.getByLabel('Endpoint').fill(`http://host.docker.internal:${String(llm?.port ?? 0)}`);
  await dialog.getByRole('button', { name: 'Save credential' }).click();
  await expect(dialog).toHaveCount(0);

  const card = page.getByRole('listitem', { name: label });
  await card.getByRole('button', { name: `Test connection for ${label}` }).click();
  await expect(card.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });

  const defaults = page.getByRole('region', { name: 'Default model' });
  const credentialSelect = defaults.getByLabel('Credential');
  const value = await credentialSelect.locator('option', { hasText: label }).getAttribute('value');
  await credentialSelect.selectOption(value ?? '');
  await defaults.getByRole('button', { name: 'Load models' }).click();
  await expect(defaults.getByLabel('Model')).toHaveValue(MODEL, { timeout: 30_000 });
  await defaults.getByRole('button', { name: 'Set as default' }).click();
  await expect(defaults.locator('[aria-live="polite"]')).toContainText(MODEL);
});

test('designer prompts the agents, edits a screen and plays the prototype', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, ADMIN);
  await ensureTeam(page);
  await page.goto('/files/drafts');

  // New design file (in Drafts) → studio.
  await page.getByRole('button', { name: 'New design file' }).click();
  const create = page.getByRole('dialog', { name: 'New design file' });
  await create.getByLabel('File name').fill(projectName);
  await create.getByRole('button', { name: 'Create file' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
  await expectAccessible(page);

  // Prompt the agent team and follow the live run.
  const prompt = page.getByLabel('Design request');
  await prompt.fill('A sign-in screen for plan participants and their retirement plan dashboard');
  await page.getByRole('button', { name: 'Generate' }).click();
  const run = page.getByRole('region', { name: 'Current run' });
  await expect(run.getByText('Saved to the project and checkpointed')).toBeVisible({
    timeout: 60_000,
  });
  await expect(prompt).toBeEnabled();

  // Screens render live on the preview origin (a different site, sandboxed iframe). The "/" screen
  // is written into the project's existing Home page, which keeps its name.
  const signInScreen = page.getByRole('region', { name: /^Screen \d+: Home$/ });
  await expect(signInScreen).toBeVisible();
  await expect(page.getByRole('region', { name: /^Screen \d+: Dashboard$/ })).toBeVisible();
  const signInFrame = page.frameLocator('iframe[title="Preview of Home"]');
  const heading = signInFrame.getByRole('heading', { name: 'Welcome back' });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const src = await page.locator('iframe[title="Preview of Home"]').getAttribute('src');
  expect(new URL(src ?? '').origin).not.toBe(new URL(page.url()).origin);
  await expect(
    page.frameLocator('iframe[title="Preview of Dashboard"]').getByText('$248,310'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.screenshot({ path: `${SCREENSHOTS}/studio-generated.png` });

  // Select an element on the canvas and change its text in the Design panel.
  await clickOnCanvas(page, 'Preview of Home', 'h1');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByRole('heading', { name: '<h1>' })).toBeVisible();
  const text = inspector.getByLabel('Text');
  await expect(text).toHaveValue('Welcome back');
  await text.fill('Welcome to your plan');
  await text.blur();
  await expect(signInFrame.getByRole('heading', { name: 'Welcome to your plan' })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: `${SCREENSHOTS}/studio-design-panel.png` });

  // The edit is in the project source: it survives a reload.
  await page.reload();
  await expect(
    page
      .frameLocator('iframe[title="Preview of Home"]')
      .getByRole('heading', { name: 'Welcome to your plan' }),
  ).toBeVisible({ timeout: 30_000 });

  // Prototype: the generated on-click link navigates between screens.
  await inspector.getByRole('tab', { name: 'Prototype' }).click();
  await page.screenshot({ path: `${SCREENSHOTS}/studio-prototype-tab.png` });
  await inspector.getByRole('button', { name: /Play/ }).click();
  const player = page.getByRole('dialog');
  const playFrame = player.frameLocator('iframe');
  await playFrame.getByRole('button', { name: 'Continue' }).click();
  await expect(playFrame.getByRole('heading', { name: 'Your plan' })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: `${SCREENSHOTS}/studio-play.png` });
  await player.getByRole('button', { name: 'Close prototype' }).click();

  // History: download the project as a runnable React app, then restore the generated version.
  await page.getByRole('tab', { name: 'History' }).click();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByRole('listitem', { name: 'AI: Retirement sign-in' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    history.getByRole('link', { name: 'Export current work (React project)' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^retirement-[0-9a-f]{6}\.zip$/);
  await download.saveAs('test-results/studio-export.zip');
  const files = readZip(await readFile(await download.path()));
  const prefix = download.suggestedFilename().replace(/\.zip$/, '');
  expect(files.has(`${prefix}/package.json`)).toBe(true);
  // The edited heading is in the export even though it was never checkpointed.
  const home = [...files.entries()].find(
    ([name, data]) =>
      name.endsWith('.tsx') && data.toString('utf8').includes('Welcome to your plan'),
  );
  expect(home).toBeDefined();
  await page.screenshot({ path: `${SCREENSHOTS}/studio-history.png` });

  await history.getByRole('button', { name: 'Restore “AI: Retirement sign-in”' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    page
      .frameLocator('iframe[title="Preview of Home"]')
      .getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible({ timeout: 30_000 });
  // The unsaved edit was kept as an automatic checkpoint before the restore.
  await expect(history.getByRole('listitem', { name: 'Before restore (automatic)' })).toBeVisible();
});

test('metrics, agents and design systems reflect the run', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, ADMIN);
  await page.goto('/metrics');
  await expect(page.getByText(MODEL).first()).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/metrics.png`, fullPage: true });

  await page.goto('/settings/agents');
  await expect(page.getByText('Orchestrator').first()).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/settings-agents.png`, fullPage: true });

  await page.goto('/settings/design-systems');
  await expect(page.getByText('CORE 2.0').first()).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: `${SCREENSHOTS}/settings-design-systems.png`, fullPage: true });
});
