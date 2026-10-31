import { expect, test, FIXTURES } from './fixtures';

test('Simplified Chinese: panel, Settings and the Studio follow the language setting', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), language: 'zh-CN' } });
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('截取整页')).toBeVisible();
  await expect(popup.getByRole('radio', { name: '深色' })).toBeVisible();

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(options.getByText('页面宽度', { exact: true })).toBeVisible();
  // Back to English from Settings: the page changes at once.
  await options
    .getByRole('radiogroup', { name: '语言' })
    .getByRole('radio', { name: /English/ })
    .click();
  await expect(options.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await options
    .getByRole('radiogroup', { name: 'Language' })
    .getByRole('radio', { name: /简体中文/ })
    .click();
  await expect(options.getByRole('heading', { name: '设置' })).toBeVisible();

  const page = await context.newPage();
  await page.goto(`${FIXTURES}/article.html`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/article.html`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1280, height: 800 });
  await expect(studio.getByRole('tab', { name: '页面' })).toBeVisible({ timeout: 60_000 });
  await expect(studio.getByRole('tab', { name: '标注' })).toBeVisible();
  await expect(studio.getByRole('button', { name: '保存 PDF', exact: true })).toBeVisible();
  await expect(studio.getByText(/\d+ 页/).first()).toBeVisible();
  await studio.waitForTimeout(800);
  await studio.screenshot({ path: 'e2e-artifacts/studio-zh.png' });
});
