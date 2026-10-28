import { expect, test } from './fixtures';

test('extension loads; the icon opens the panel with every mode and the settings', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe('ScreenScroll');
  expect(manifest.action?.default_popup).toBe('popup.html');
  expect(Object.keys(manifest.commands ?? {}).sort()).toEqual([
    'capture-element',
    'capture-full',
    'capture-selection',
    'capture-visible',
  ]);

  // The panel as it looks over a normal page (opened as a tab it would see itself).
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    const q = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = ((info: chrome.tabs.QueryInfo) =>
      info.active
        ? Promise.resolve([{ id: 1, url: 'https://example.org/a' } as chrome.tabs.Tab])
        : q(info)) as typeof chrome.tabs.query;
  });
  await popup.setViewportSize({ width: 320, height: 520 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('button', { name: /Capture full page/ })).toBeEnabled();
  for (const m of ['Visible', 'Area', 'Line to line', 'Element', 'Panel'])
    await expect(popup.getByRole('button', { name: m, exact: true })).toBeEnabled();

  // Settings change at once and are stored.
  await popup.getByRole('radio', { name: 'Save PDF' }).click();
  await expect(popup.getByText('Saves a PDF right away')).toBeVisible();
  await popup.getByRole('combobox').selectOption('Letter');
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const s = (await chrome.storage.local.get('settings')).settings as {
          afterCapture: string;
          page: { paper: string };
        };
        return [s.afterCapture, s.page.paper];
      }),
    )
    .toEqual(['pdf', 'Letter']);
  await popup.getByRole('radio', { name: '5 seconds' }).click();
  await expect(popup.getByRole('radio', { name: '5 seconds' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await popup.locator('main').screenshot({ path: 'docs/screenshots/panel.png' });
});

test('fixture server is reachable', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5177/article.html');
  await expect(page.getByRole('heading', { name: 'Article fixture' })).toBeVisible();
});
