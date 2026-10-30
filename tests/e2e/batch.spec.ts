import { readFileSync } from 'node:fs';
import { expect, test, FIXTURES } from './fixtures';

/** Capture several pages: tabs of the window, or a list of addresses (ROADMAP M5). */

test('batch: tabs of this window, blocked ones named, no Studio per page, then one PDF', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(180_000);
  for (const path of ['article.html', 'tiny.html']) {
    const page = await context.newPage();
    await page.goto(`${FIXTURES}/${path}`);
  }
  const browserPage = await context.newPage();
  await browserPage.goto('chrome://version');
  const batch = await context.newPage();
  await batch.goto(`chrome-extension://${extensionId}/batch.html`);
  await batch.bringToFront();

  const tabs = batch.getByRole('region', { name: 'Tabs in this window' });
  await expect(tabs.getByText('Article fixture')).toBeVisible();
  // A browser page can't be captured: it says so and can't be chosen.
  await expect(tabs.getByText(/can’t be captured/).first()).toBeVisible();
  const startButton = tabs.getByRole('button', { name: /^Capture \d+ tabs?$/ });
  await expect(startButton).toHaveText('Capture 2 tabs');
  await startButton.click();

  const progress = batch.getByRole('region', { name: 'Progress' });
  await expect(progress.getByRole('heading')).toHaveText('Done: 2 of 2 captured', {
    timeout: 120_000,
  });
  await expect(progress.locator('li[data-status="done"]')).toHaveCount(2);
  // Saved quietly: no Studio tab for each page.
  expect(context.pages().filter((p) => p.url().includes('studio.html'))).toHaveLength(0);

  await progress.getByRole('button', { name: 'Merge into one PDF' }).click();
  const sheet = batch.getByRole('region', { name: 'Merge into one PDF' });
  await expect(sheet.getByRole('listitem')).toHaveText([/Article fixture/, /Tiny/]);
  const dl = batch.waitForEvent('download', { timeout: 90_000 });
  await sheet.getByRole('button', { name: 'Save as one PDF' }).click();
  const bytes = readFileSync(await (await dl).path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(sheet.getByRole('status')).toHaveText(/^Saved \d+ pages as /);
});

test('batch: a list of addresses opens each, captures it and closes it again', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const batch = await context.newPage();
  await batch.goto(`chrome-extension://${extensionId}/batch.html`);
  await batch.bringToFront();
  const before = context.pages().length;
  const box = batch.getByRole('textbox', { name: 'Addresses, one per line' });
  await box.fill(`${FIXTURES}/tiny.html\n${FIXTURES}/article.html\nchrome://settings`);
  await expect(batch.getByText('Not web addresses, left out: chrome://settings')).toBeVisible();
  await batch.getByRole('button', { name: 'Capture 2 addresses' }).click();

  const progress = batch.getByRole('region', { name: 'Progress' });
  await expect(progress.getByRole('heading')).toHaveText('Done: 2 of 2 captured', {
    timeout: 120_000,
  });
  await expect(progress.getByText('Tiny')).toBeVisible();
  await expect(progress.getByText('Article fixture')).toBeVisible();
  // The tabs it opened are closed again, and the batch page is back in front.
  await expect.poll(() => context.pages().length).toBe(before);
  await expect.poll(() => batch.evaluate(() => document.visibilityState)).toBe('visible');
});
