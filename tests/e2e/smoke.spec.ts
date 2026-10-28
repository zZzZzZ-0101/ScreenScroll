import { expect, test } from './fixtures';

test('extension loads: no popup, the icon click captures, menus are registered', async ({
  serviceWorker,
}) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe('ScreenScroll');
  // No popup or start page: a click on the icon goes straight to capturing (UI §1).
  expect(manifest.action?.default_popup).toBeUndefined();
  expect(manifest.action?.default_title).toMatch(/click to capture the full page/);
  expect(Object.keys(manifest.commands ?? {}).sort()).toEqual([
    'capture-element',
    'capture-full',
    'capture-selection',
    'capture-visible',
  ]);
});

test('fixture server is reachable', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5177/article.html');
  await expect(page.getByRole('heading', { name: 'Article fixture' })).toBeVisible();
});
