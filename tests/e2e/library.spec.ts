import type { Worker } from '@playwright/test';
import { expect, test, FIXTURES } from './fixtures';

type Hook = { capture(tabId: number): Promise<{ id: string }> };

/** Raw IndexedDB from the service worker (the extension's CSP forbids eval, so no helpers). */
const count = (sw: Worker, store: string) =>
  sw.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open('scrollpress');
      r.onsuccess = () => res(r.result);
    });
    return new Promise<number>((res) => {
      const r = db.transaction(name).objectStore(name).count();
      r.onsuccess = () => res(r.result);
    });
  }, store);

const ageAll = (sw: Worker) =>
  sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res) => {
      const r = indexedDB.open('scrollpress');
      r.onsuccess = () => res(r.result);
    });
    const tx = db.transaction('sessions', 'readwrite');
    const st = tx.objectStore('sessions');
    const all = await new Promise<Array<{ capturedAt: string }>>((r) => {
      const q = st.getAll();
      q.onsuccess = () => r(q.result);
    });
    for (const x of all) st.put({ ...x, capturedAt: '2020-01-01T00:00:00.000Z' });
    await new Promise((r) => (tx.oncomplete = r));
  });

test('saved captures: size, search, open, delete with undo, auto-clean', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(120_000);
  for (const path of ['tiny.html', 'article.html']) {
    const page = await context.newPage();
    await page.goto(`${FIXTURES}/${path}`);
    await page.bringToFront();
    await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
    }, `${FIXTURES}/${path}`);
  }
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  const rows = lib.getByTestId('capture-row');
  await expect(rows).toHaveCount(2);
  await expect(lib.getByTestId('space')).toHaveText(/^2 captures · \d/);
  await expect(rows.first()).toContainText('Article fixture'); // newest first
  await lib.screenshot({ path: 'docs/screenshots/saved-captures.png' });

  // Search narrows the list.
  await lib.getByRole('searchbox', { name: 'Search captures' }).fill('tiny');
  await expect(rows).toHaveCount(1);
  await lib.getByRole('searchbox', { name: 'Search captures' }).fill('');

  // Open reopens the Studio for that capture.
  const studio = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await rows.first().getByRole('button', { name: 'Open' }).click();
  await (await studio).close();

  // Delete, then Undo: nothing is lost.
  await lib.getByRole('button', { name: 'Delete Tiny' }).click();
  await expect(rows).toHaveCount(1);
  await lib.getByRole('button', { name: 'Undo' }).click();
  await expect(rows).toHaveCount(2);

  // Delete selected for real: the frames go too.
  await lib.getByRole('checkbox', { name: 'Select Tiny' }).check();
  await lib.getByRole('button', { name: /Delete selected \(1\)/ }).click();
  await expect(lib.getByRole('status')).toContainText('Capture deleted.');
  await expect(rows).toHaveCount(1);
  await expect.poll(() => count(serviceWorker, 'sessions'), { timeout: 10_000 }).toBe(1);
  const framesLeft = await count(serviceWorker, 'frames');

  // Auto-clean: a capture from 2020 goes when "keep 30 days" is set.
  await ageAll(serviceWorker);
  await lib.getByRole('combobox').selectOption('30');
  await lib.reload();
  await expect(lib.getByText(/1 capture older than 30 days was deleted/)).toBeVisible();
  await expect(lib.getByText('No saved captures.')).toBeVisible();
  expect(await count(serviceWorker, 'frames')).toBe(0);
  expect(framesLeft).toBeGreaterThan(0);
});
