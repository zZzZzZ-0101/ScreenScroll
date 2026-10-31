import { expect, test, FIXTURES } from './fixtures';

// A real window: the page's width follows it, so narrowing it reflows the page.
test.use({ windowed: true });

interface Done {
  status: string;
  docWidth: number;
  docHeight: number;
  warnings: string[];
}

async function setWidth(sw: import('@playwright/test').Worker, width: number) {
  await sw.evaluate(async (w) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...(settings ?? {}), capture: { ...(settings?.capture ?? {}), width: w } },
    });
  }, width);
}

async function capture(
  sw: import('@playwright/test').Worker,
  page: import('@playwright/test').Page,
  url: string,
) {
  // The Studio tab of an earlier capture may be in front.
  await page.bringToFront();
  return sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    const win = await chrome.windows.get(tab!.windowId);
    const hook = (
      globalThis as unknown as {
        __spTest: { capture(id: number): Promise<{ done: Done }> };
      }
    ).__spTest;
    const { done } = await hook.capture(tab!.id!);
    const after = await chrome.windows.get(tab!.windowId);
    return {
      done,
      before: { w: win.width, h: win.height, l: win.left, t: win.top, s: win.state },
      after: { w: after.width, h: after.height, l: after.left, t: after.top, s: after.state },
    };
  }, url);
}

test('Page width 1000: a fluid page is captured 1000 px wide, then the window is put back', async ({
  context,
  serviceWorker,
}) => {
  const url = `${FIXTURES}/fluid.html`;
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  const wide = await page.evaluate(() => document.documentElement.clientWidth);
  expect(wide).toBeGreaterThan(1300);

  // Off: as it is.
  const off = await capture(serviceWorker, page, url);
  expect(off.done.status).toBe('complete');
  expect(off.done.docWidth).toBe(wide);

  await setWidth(serviceWorker, 1000);
  const r = await capture(serviceWorker, page, url);
  expect(r.done.status).toBe('complete');
  expect(r.done.docWidth).toBe(1000);
  // Narrower lines → more of them: the page is taller than at full width.
  expect(r.done.docHeight).toBeGreaterThan(off.done.docHeight * 1.2);
  expect(r.done.warnings.join(' ')).not.toMatch(/Page width/);
  // The window is exactly as it was, and so is the page.
  expect(r.after).toEqual(r.before);
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(wide);
  // The session record no longer holds a window to put back.
  const pending = await serviceWorker.evaluate(async () => {
    const req = indexedDB.open('scrollpress');
    const d: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    const all: { window?: unknown }[] = await new Promise((res) => {
      const g = d.transaction('sessions').objectStore('sessions').getAll();
      g.onsuccess = () => res(g.result);
    });
    return all.filter((s) => s.window).length;
  });
  expect(pending).toBe(0);
});

test('Page width: Esc mid-capture puts the window back too', async ({ context, serviceWorker }) => {
  const url = `${FIXTURES}/fluid.html`;
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  await setWidth(serviceWorker, 1000);
  const before = await serviceWorker.evaluate(async () => {
    const w = await chrome.windows.getCurrent();
    return w.width;
  });
  const id = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    return (
      globalThis as unknown as { __spTest: { start(id: number): Promise<string> } }
    ).__spTest.start(tab!.id!);
  }, url);
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(1000);
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement!.scrollTop), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const done = await serviceWorker.evaluate(
    (i) =>
      (
        globalThis as unknown as { __spTest: { wait(id: string): Promise<{ done: Done }> } }
      ).__spTest.wait(i),
    id,
  );
  expect(done.done.status).toBe('cancelled');
  await expect
    .poll(() => serviceWorker.evaluate(async () => (await chrome.windows.getCurrent()).width))
    .toBe(before);
});

test('Page width: closing the tab mid-capture puts the window back', async ({
  context,
  serviceWorker,
}) => {
  const url = `${FIXTURES}/fluid.html`;
  // A second tab keeps the window open when the captured one closes.
  const other = await context.newPage();
  await other.goto(`${FIXTURES}/article.html`);
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  await setWidth(serviceWorker, 1000);
  const before = await serviceWorker.evaluate(
    async () => (await chrome.windows.getCurrent()).width,
  );
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    return (
      globalThis as unknown as { __spTest: { start(id: number): Promise<string> } }
    ).__spTest.start(tab!.id!);
  }, url);
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(1000);
  await page.close();
  await expect
    .poll(() => serviceWorker.evaluate(async () => (await chrome.windows.getCurrent()).width))
    .toBe(before);
});
