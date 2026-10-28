import { expect, test } from './fixtures';

test('extension loads and the popup renders', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('heading', { name: 'ScreenScroll' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Capture full page/ })).toBeVisible();
});

test('fixture server is reachable', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5177/article.html');
  await expect(page.getByRole('heading', { name: 'Article fixture' })).toBeVisible();
});
