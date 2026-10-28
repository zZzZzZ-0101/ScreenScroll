import { readFileSync } from 'node:fs';
import { expect, test, FIXTURES } from './fixtures';

test('After capture → Save PDF directly: a PDF is downloaded and the Studio tab closes', async ({
  context,
  serviceWorker,
}) => {
  await serviceWorker.evaluate(async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings?: object };
    await chrome.storage.local.set({ settings: { ...settings, afterCapture: 'pdf' } });
  });
  const page = await context.newPage();
  const url = `${FIXTURES}/article.html`;
  await page.goto(url);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('auto=pdf'),
  });
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, url);
  const studio = await studioPromise;
  const downloadPromise = studio.waitForEvent('download', { timeout: 60_000 });
  await studio.waitForEvent('close', { timeout: 60_000 });
  const download = await downloadPromise;
  // Playwright stores downloads under GUID names, so check the name the extension asked for.
  const requested = await serviceWorker.evaluate(
    async () => (await chrome.storage.session.get('lastDownload')).lastDownload as string,
  );
  expect(requested).toMatch(/^Article fixture_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/);
  const path = await download.path();
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
});
