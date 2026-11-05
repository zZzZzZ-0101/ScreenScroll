import { expect, test, FIXTURES } from './fixtures';

/**
 * The toolbar panel's own path: the panel sends "sp:popup-capture" and the background
 * captures the active tab of the focused window. (The e2e hooks call startCapture
 * directly; this checks the message path the user's click takes.)
 */
for (const width of [0, 1000]) {
  test(`panel: Capture full page starts a capture of the page in front (page width ${width || 'off'})`, async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await serviceWorker.evaluate(async (w) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({
        settings: { ...(settings ?? {}), capture: { ...(settings?.capture ?? {}), width: w } },
      });
    }, width);
    const page = await context.newPage();
    await page.goto(`${FIXTURES}/article.html`);
    // The panel, as an extension page in a window of its own, not focused.
    await serviceWorker.evaluate(
      async (url) => void (await chrome.windows.create({ url, focused: false, type: 'popup' })),
      `chrome-extension://${extensionId}/popup.html`,
    );
    await expect.poll(() => context.pages().some((p) => p.url().includes('popup.html'))).toBe(true);
    const panel = context.pages().find((p) => p.url().includes('popup.html'))!;
    await page.bringToFront();
    await serviceWorker.evaluate(async (u) => {
      const [tab] = await chrome.tabs.query({ url: u });
      await chrome.windows.update(tab!.windowId, { focused: true });
    }, `${FIXTURES}/article.html`);
    const studio = context.waitForEvent('page', {
      predicate: (p) => p.url().includes('/studio.html'),
      timeout: 60_000,
    });
    const res = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'sp:popup-capture', mode: 'full', delayMs: 0 }),
    );
    expect(res).toEqual({ ok: true });
    await studio;
  });
}

test('panel: a capture left "running" by a reload or crash does not lock the buttons', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/article.html`;
  await page.goto(url);
  await serviceWorker.evaluate(
    async (u) => void (await chrome.windows.create({ url: u, focused: false, type: 'popup' })),
    `chrome-extension://${extensionId}/popup.html`,
  );
  await expect.poll(() => context.pages().some((p) => p.url().includes('popup.html'))).toBe(true);
  const panel = context.pages().find((p) => p.url().includes('popup.html'))!;
  // Let the extension open its database first (the leftover goes into its tables).
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'sp:running' }));
  // The leftover: a record that says "capturing" on this tab, with no capture behind it.
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    const req = indexedDB.open('scrollpress');
    const d: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    await new Promise((res) => {
      const tx = d.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put({
        id: 'stale-1',
        url: u,
        title: 'Stale',
        capturedAt: new Date().toISOString(),
        status: 'capturing',
        docWidth: 0,
        docHeight: 0,
        frameCount: 0,
        warnings: [],
        tabId: tab!.id,
        windowId: tab!.windowId,
      });
      tx.oncomplete = res;
    });
  }, url);
  await page.bringToFront();
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    await chrome.windows.update(tab!.windowId, { focused: true });
  }, url);
  // Not running: the page has no capture, so the record is the leftover it is.
  expect(await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'sp:running' }))).toBeNull();
  const status = await serviceWorker.evaluate(async () => {
    const req = indexedDB.open('scrollpress');
    const d: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    return new Promise<{ status: string; warnings: string[] }>((res) => {
      const g = d.transaction('sessions').objectStore('sessions').get('stale-1');
      g.onsuccess = () => res(g.result);
    });
  });
  expect(status.status).toBe('error');
  expect(status.warnings.join(' ')).toMatch(/interrupted/);
  // And a capture from the panel works on that tab.
  const studio = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 60_000,
  });
  expect(
    await panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'sp:popup-capture', mode: 'full', delayMs: 0 }),
    ),
  ).toEqual({ ok: true });
  await studio;
});

test('panel: speed, sharpness and page width are one click, and the window narrowing is explained', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 720 });
  await panel.goto(`chrome-extension://${extensionId}/popup.html`);
  const radio = (group: string, name: string) =>
    panel.getByRole('radiogroup', { name: group }).getByRole('radio', { name });
  await expect(radio('Speed', 'Normal')).toBeChecked();
  await expect(radio('Sharpness', '1×')).toBeChecked();
  await expect(radio('Page width', 'As shown')).toBeChecked();
  await expect(panel.getByTestId('width-note')).toHaveCount(0);

  await radio('Speed', 'Fast').click();
  await radio('Page width', '1000 px').click();
  await expect(panel.getByTestId('width-note')).toHaveText(
    'The browser window narrows to 1000 px while capturing, then comes back.',
  );
  await panel.screenshot({ path: 'e2e-artifacts/panel-options.png' });
  const stored = await serviceWorker.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings.capture,
  );
  expect(stored).toMatchObject({ speed: 'fast', width: 1000 });
  // And back.
  await radio('Page width', 'As shown').click();
  await expect(panel.getByTestId('width-note')).toHaveCount(0);
});
