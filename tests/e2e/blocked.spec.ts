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

test('a click on the icon over a browser page marks the icon with the reason', async ({
  context,
  serviceWorker,
}) => {
  type Hook = {
    click(id: number): Promise<string | null>;
    badge(id: number): Promise<{ text: string; title: string }>;
  };
  const page = await context.newPage();
  await page.goto('chrome://version');
  await page.bringToFront();
  const flagged = await serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true });
    const hook = (globalThis as unknown as { __spTest: Hook }).__spTest;
    const started = await hook.click(tab!.id!);
    return { started, ...(await hook.badge(tab!.id!)), tabId: tab!.id! };
  });
  expect(flagged.started).toBeNull();
  expect(flagged.text).toBe('!');
  expect(flagged.title).toMatch(/^ScreenScroll: This page can’t be captured/);

  // A normal page in the same tab captures, and the mark goes away.
  const studio = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await page.goto('http://localhost:5177/tiny.html');
  const cleared = await serviceWorker.evaluate(async (tabId) => {
    const hook = (globalThis as unknown as { __spTest: Hook }).__spTest;
    const started = await hook.click(tabId);
    return { started, ...(await hook.badge(tabId)) };
  }, flagged.tabId);
  expect(cleared.started).toEqual(expect.any(String));
  expect(cleared.text).toBe('');
  expect(cleared.title).toMatch(/click to capture the full page/);
  await studio;
});

test('icon menu: the skip-preview switch is stored; the 5-second entry waits', async ({
  context,
  serviceWorker,
}) => {
  type Hook = { menu(id: string, tabId: number, checked?: boolean): Promise<string | null> };
  const page = await context.newPage();
  await page.goto('http://localhost:5177/tiny.html');
  await page.bringToFront();
  const tabId = await serviceWorker.evaluate(
    async () => (await chrome.tabs.query({ active: true }))[0]!.id!,
  );
  const afterCapture = () =>
    serviceWorker.evaluate(
      async () =>
        ((await chrome.storage.local.get('settings')).settings as { afterCapture?: string })
          ?.afterCapture,
    );
  await serviceWorker.evaluate(
    ([id]) =>
      (globalThis as unknown as { __spTest: Hook }).__spTest.menu('sp-icon-skip', id!, true),
    [tabId],
  );
  expect(await afterCapture()).toBe('pdf');
  await serviceWorker.evaluate(
    ([id]) =>
      (globalThis as unknown as { __spTest: Hook }).__spTest.menu('sp-icon-skip', id!, false),
    [tabId],
  );
  expect(await afterCapture()).toBe('studio');

  // "Full page in 5 seconds": the countdown shows in the page before anything is captured.
  const studio = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  const t0 = Date.now();
  await serviceWorker.evaluate(
    ([id]) => (globalThis as unknown as { __spTest: Hook }).__spTest.menu('sp-icon-delay', id!),
    [tabId],
  );
  await studio;
  expect(Date.now() - t0).toBeGreaterThan(4500);
});
