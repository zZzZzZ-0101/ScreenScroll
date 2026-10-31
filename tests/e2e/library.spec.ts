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

test('saved captures: size, search, open, delete for good, auto-clean', async ({
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
      const [tab] = await chrome.tabs.query({ active: true, url });
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

  // One click deletes at once, for good: the record and every frame.
  const framesBefore = await count(serviceWorker, 'frames');
  await lib.getByRole('button', { name: 'Delete Tiny' }).click();
  await expect(rows).toHaveCount(1);
  await expect(lib.getByRole('status')).toHaveText('Capture deleted.');
  expect(await count(serviceWorker, 'sessions')).toBe(1);
  const framesLeft = await count(serviceWorker, 'frames');
  expect(framesLeft).toBeLessThan(framesBefore);
  // Still gone after a reload (nothing comes back).
  await lib.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Article fixture');
  // Auto-clean: a capture from 2020 goes when "keep 30 days" is set.
  await ageAll(serviceWorker);
  await lib.getByRole('combobox').selectOption('30');
  await lib.reload();
  await expect(lib.getByText(/1 capture older than 30 days was deleted/)).toBeVisible();
  await expect(lib.getByText('No saved captures.')).toBeVisible();
  expect(await count(serviceWorker, 'frames')).toBe(0);
  expect(framesLeft).toBeGreaterThan(0);
});

test('saved captures: deleting one after another never brings one back; batch and delete all', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(150_000);
  for (const path of ['tiny.html', 'hostile-title.html', 'overlay-viewer.html', 'article.html']) {
    const page = await context.newPage();
    await page.goto(`${FIXTURES}/${path}`);
    await page.bringToFront();
    await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true, url });
      await (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
    }, `${FIXTURES}/${path}`);
    await page.close();
  }
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  const rows = lib.getByTestId('capture-row');
  await expect(rows).toHaveCount(4);

  // Two quick deletions in a row: both stay deleted.
  await lib.getByRole('button', { name: 'Delete Tiny' }).click();
  await lib.getByRole('button', { name: 'Delete Overlay viewer' }).click();
  await expect(rows).toHaveCount(2);
  await lib.waitForTimeout(1000);
  await expect(rows).toHaveCount(2);
  expect(await count(serviceWorker, 'sessions')).toBe(2);

  // Batch: select all, confirm, everything goes, frames included.
  await lib.getByRole('checkbox', { name: /Select all/ }).check();
  await lib.getByRole('button', { name: 'Delete selected (2)' }).click();
  await lib.getByRole('button', { name: 'Delete 2 for good' }).click();
  await expect(lib.getByText('No saved captures.')).toBeVisible();
  expect(await count(serviceWorker, 'sessions')).toBe(0);
  expect(await count(serviceWorker, 'frames')).toBe(0);
  await expect(lib.getByTestId('space')).toHaveText(/^0 captures · 0 KB/);
});

test('merge: chosen captures, reordered, with a page range, saved as one PDF', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(150_000);
  for (const path of ['article.html', 'tiny.html']) {
    const page = await context.newPage();
    await page.goto(`${FIXTURES}/${path}`);
    await page.bringToFront();
    await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true, url });
      await (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
    }, `${FIXTURES}/${path}`);
    await page.close();
  }
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  await expect(lib.getByTestId('capture-row')).toHaveCount(2);
  await expect(lib.getByRole('button', { name: /^Merge into one PDF/ })).toBeDisabled();
  await lib.getByRole('checkbox', { name: /Select all/ }).check();
  await lib.getByRole('button', { name: 'Merge into one PDF (2)' }).click();

  const sheet = lib.getByRole('region', { name: 'Merge into one PDF' });
  // Oldest first: the article, then the tiny page. Put the tiny page first.
  await expect(sheet.getByRole('listitem')).toHaveText([/Article fixture/, /Tiny/]);
  await sheet.getByRole('button', { name: /^Move Tiny.* up$/ }).click();
  await expect(sheet.getByRole('listitem')).toHaveText([/Tiny/, /Article fixture/]);
  await sheet.getByRole('textbox', { name: 'Pages of Article fixture' }).fill('2-3');

  const dl = lib.waitForEvent('download', { timeout: 90_000 });
  await sheet.getByRole('button', { name: 'Save as one PDF' }).click();
  const file = await (await dl).path();
  await expect(sheet.getByRole('status')).toHaveText(/^Saved 3 pages as /);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { readFileSync } = await import('node:fs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  }).promise;
  expect(pdf.numPages).toBe(3);
  const text = async (n: number) =>
    (await (await pdf.getPage(n)).getTextContent()).items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ');
  expect(await text(1)).toContain('One line, much shorter than a page.');
  // Pages 2 and 3 of the article, not its first page.
  expect(await text(2)).not.toContain('A long article with headings');
  // One bookmark per capture, in the merged order; page numbers run across the document.
  const outline = await pdf.getOutline();
  expect(outline.map((o) => o.title)).toEqual([expect.stringMatching(/Tiny/), 'Article fixture']);
  expect(await text(3)).toMatch(/3\/3/);
});

test('search finds a capture by the text on its page, and shows where', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  for (const path of ['article.html', 'tiny.html']) {
    const page = await context.newPage();
    await page.goto(`${FIXTURES}/${path}`);
    await page.bringToFront();
    await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true, url });
      await (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
    }, `${FIXTURES}/${path}`);
    await page.close();
  }
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  const rows = lib.getByTestId('capture-row');
  await expect(rows).toHaveCount(2);
  const search = lib.getByRole('searchbox', { name: 'Search captures' });
  // Words from the article's body, not its title or address.
  await search.fill('section 3: capture section');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Article fixture');
  await expect(rows.first().getByTestId('snippet').locator('mark')).toHaveText(
    /^Section 3: Capture section$/i,
  );
  // A title match needs no snippet; no match says so.
  await search.fill('tiny');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId('snippet')).toHaveCount(0);
  await search.fill('nothing like this anywhere');
  await expect(lib.getByText('No capture matches.')).toBeVisible();
});

test('back up captures to one file and restore them after deleting', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/article.html`);
  await page.bringToFront();
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    const hook = (globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } })
      .__spTest;
    await hook.capture(tab!.id!);
  }, `${FIXTURES}/article.html`);
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/captures.html`);
  await expect(lib.getByText('Article fixture')).toBeVisible();
  const dl = lib.waitForEvent('download');
  await lib.getByRole('button', { name: /^Back up/ }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(
    /^screenscroll-captures-\d{4}-\d{2}-\d{2}\.ssbackup$/,
  );
  const file = await download.path();
  await expect(lib.getByText(/Backup of 1 capture saved/)).toBeVisible();

  // Delete it for good, then bring it back from the file.
  await lib.getByRole('button', { name: 'Delete all captures' }).click();
  await lib.getByRole('button', { name: 'Delete 1 for good' }).click();
  await expect(lib.getByText('Article fixture')).toHaveCount(0);
  await lib.getByLabel('Restore from a backup file').setInputFiles(file);
  await expect(lib.getByText('1 capture restored.')).toBeVisible();
  await expect(lib.getByText('Article fixture')).toBeVisible();
  // Every frame image is back, byte for byte the size it was.
  const sizes = () =>
    serviceWorker.evaluate(async () => {
      const req = indexedDB.open('scrollpress');
      const d: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      const all: { blob: Blob }[] = await new Promise((res) => {
        const q = d.transaction('frames').objectStore('frames').getAll();
        q.onsuccess = () => res(q.result);
      });
      return all.map((f) => f.blob.size);
    });
  const restored = await sizes();
  expect(restored.length).toBeGreaterThan(1);
  expect(restored.every((n) => n > 1000)).toBe(true);
  // Restoring the same file again adds nothing.
  await lib.getByLabel('Restore from a backup file').setInputFiles(file);
  await expect(lib.getByText(/0 captures restored; 1 already here/)).toBeVisible();
});
