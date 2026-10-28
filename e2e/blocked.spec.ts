import { expect, test } from './fixtures';

test('browser pages are refused with a clear message', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto('chrome://version');
  await page.bringToFront();
  const outcome = await serviceWorker.evaluate(async () => {
    // URL patterns can't match chrome:// pages, so take the active tab (brought to front above).
    const [tab] = await chrome.tabs.query({ active: true });
    const hook = (globalThis as unknown as { __spTest: { start(id: number): Promise<string> } })
      .__spTest;
    try {
      await hook.start(tab!.id!);
      return 'started';
    } catch (e) {
      return (e as Error).message;
    }
  });
  // The URL of chrome:// pages is hidden from extensions without the `tabs` permission.
  expect(outcome).toBe(
    'This page can’t be captured. The browser blocks extensions on its own pages (chrome://, edge://) and on the extension store.',
  );
});
