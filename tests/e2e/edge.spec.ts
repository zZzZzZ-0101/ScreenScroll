import type { BrowserContext, Page, Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { expect, test, FIXTURES } from './fixtures';

/** Edge cases across the extension: odd pages, odd input, odd use of the UI. */

type Hook = {
  start(tabId: number, mode: string, opts?: object): Promise<string>;
  wait(id: string): Promise<{ done: { status: string; warnings: string[] }; frames: unknown[] }>;
  capture(tabId: number): Promise<unknown>;
};

async function openPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  return page;
}

const studioOpens = (context: BrowserContext) =>
  context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 60_000,
  });

async function ready(studio: Page) {
  await studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 60_000 },
  );
}

async function capture(context: BrowserContext, sw: Worker, path: string): Promise<Page> {
  await openPage(context, path);
  const studioPromise = studioOpens(context);
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    await (globalThis as unknown as { __spTest: Hook }).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/${path}`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1280, height: 800 });
  await ready(studio);
  return studio;
}

const lastDownload = (sw: Worker) =>
  sw.evaluate(
    async () => (await chrome.storage.session.get('lastDownload')).lastDownload as string,
  );

const slices = (studio: Page) =>
  studio.evaluate(
    () => (window as unknown as { __spStudio: { slices(): unknown[] } }).__spStudio.slices().length,
  );

test('a page shorter than one sheet: one page, saved as a one-page PDF', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'tiny.html');
  expect(await slices(studio)).toBe(1);
  await expect(studio.getByText(/· 1 page$/)).toBeVisible();
  await expect(studio.getByTestId('estimate')).toHaveText(/^PDF size: /);
  const dl = studio.waitForEvent('download');
  await studio.getByRole('button', { name: 'Save PDF' }).click();
  const pdf = await PDFDocument.load(readFileSync(await (await dl).path()));
  expect(pdf.getPageCount()).toBe(1);
});

test('a title full of forbidden characters becomes a safe file name', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'hostile-title.html');
  const dl = studio.waitForEvent('download');
  await studio.getByRole('button', { name: 'Save PDF' }).click();
  await dl;
  const name = await lastDownload(serviceWorker);
  expect(name).toMatch(/\.pdf$/);
  expect(name).not.toMatch(/[\\/:*?"<>|]/);
  expect(name.startsWith('.')).toBe(false);
  expect(name.startsWith(' ')).toBe(false);
  expect(name).toContain('报告');
  expect(name).toContain('🙂');
  expect(name).toContain('עברית');
});

test.describe('where the file system cannot hold the title', () => {
  test.use({ utf8: false });
  test('the file is still saved, under a plain name, and the toast says why', async ({
    context,
    serviceWorker,
  }) => {
    const studio = await capture(context, serviceWorker, 'hostile-title.html');
    const dl = studio.waitForEvent('download');
    await studio.getByRole('button', { name: 'Save PDF' }).click();
    await dl;
    const name = await lastDownload(serviceWorker);
    expect(name).toMatch(/^[\x20-\x7e]+\.pdf$/);
    await expect(studio.getByRole('status')).toContainText('did not accept the page title');
  });
});

test('an empty region is reported, not silently dropped', async ({ context, serviceWorker }) => {
  await openPage(context, 'tiny.html');
  const url = `${FIXTURES}/tiny.html`;
  const id = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    return (globalThis as unknown as { __spTest: Hook }).__spTest.start(tab!.id!, 'selection', {
      region: { x0: 10, x1: 300, y0: 40, y1: 40 },
    });
  }, url);
  const result = await serviceWorker.evaluate(
    (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.wait(i),
    id,
  );
  // Either nothing was captured and the user is told why, or the Studio says it's empty.
  expect(result.done.status).not.toBe('complete');
  expect(result.done.warnings.join(' ')).toMatch(/empty|nothing/i);
});

test('a missing or deleted capture shows a clear message', async ({ context, extensionId }) => {
  const studio = await context.newPage();
  for (const q of ['?session=does-not-exist', '', '?session=']) {
    await studio.goto(`chrome-extension://${extensionId}/studio.html${q}`);
    await expect(studio.getByRole('alert')).toHaveText('This capture no longer exists.');
  }
});

test('corrupted settings in storage do not break the Studio', async ({
  context,
  serviceWorker,
}) => {
  for (const bad of [
    'garbage',
    { page: null, breakStyle: 'x', pdf: [] },
    { page: { paper: 'A99', marginsMm: { top: -1e9 } } },
  ]) {
    await serviceWorker.evaluate(async (v) => chrome.storage.local.set({ settings: v }), bad);
    const studio = await capture(context, serviceWorker, 'article.html');
    expect(await slices(studio)).toBeGreaterThan(1);
    await expect(studio.getByRole('button', { name: 'Save PDF' })).toBeEnabled();
    await studio.close();
  }
});

test('double clicks and repeated Ctrl+S save one file', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  let downloads = 0;
  studio.on('download', () => downloads++);
  const save = studio.getByRole('button', { name: 'Save PDF' });
  await save.dblclick();
  await studio.keyboard.press('Control+s');
  await expect.poll(() => downloads, { timeout: 20_000 }).toBe(1);
  // Still one after the job has had time to finish.
  await studio.waitForTimeout(3000);
  expect(downloads).toBe(1);
  // Once idle, saving works again.
  await save.click();
  await expect.poll(() => downloads, { timeout: 20_000 }).toBe(2);
});

test('fast typing in settings fields keeps every character', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  await studio.getByRole('button', { name: 'More options' }).click();
  const name = studio.getByRole('textbox', { name: 'File name' });
  await name.fill('');
  const typed = 'Quarterly report {date} final-final v2';
  await name.pressSequentially(typed, { delay: 0 });
  await expect(name).toHaveValue(typed);
  await expect(
    studio.getByText(/^Quarterly report \d{4}-\d{2}-\d{2} final-final v2\.pdf$/),
  ).toBeVisible();
  // Page labels live in Mark up → Page.
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  const header = studio.getByRole('textbox', { name: 'Header left' });
  await header.pressSequentially('{title} · draft', { delay: 0 });
  await expect(header).toHaveValue('{title} · draft');
  // Storage ends with the last value, not an earlier one that finished late.
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const s = (await chrome.storage.local.get('settings')).settings as {
          filenameTemplate: string;
          pdf: { header: { left: string } };
        };
        return [s.filenameTemplate, s.pdf.header.left];
      }),
    )
    .toEqual([typed, '{title} · draft']);
});

test('keyboard only: modes and the Save menu', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  await studio.getByRole('tab', { name: 'Breaks' }).focus();
  await studio.keyboard.press('Enter');
  await expect(studio.getByRole('tab', { name: 'Breaks' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const more = studio.getByRole('button', { name: 'More ways to save' });
  await more.focus();
  await studio.keyboard.press('Enter');
  const items = studio.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await studio.keyboard.press('ArrowUp'); // wraps to the last item
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText(/Print/);
  await studio.keyboard.press('Escape');
  await expect(studio.getByRole('menu')).toBeHidden();
  await expect(more).toBeFocused();
  // Clicking elsewhere also closes it.
  await more.click();
  await studio.mouse.click(10, 400);
  await expect(studio.getByRole('menu')).toBeHidden();
});

test('narrow window and dark mode', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  for (const [w, h] of [
    [1024, 700],
    [800, 600],
  ] as const) {
    await studio.setViewportSize({ width: w, height: h });
    for (const mode of ['Pages', 'Breaks', 'Mark up']) {
      await studio.getByRole('tab', { name: mode }).click();
      const overflow = await studio.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${w}px, ${mode}`).toBeLessThanOrEqual(0);
      await expect(studio.getByRole('button', { name: 'Save PDF' })).toBeInViewport();
    }
  }
  await studio.screenshot({ path: 'e2e-artifacts/edge-narrow-markup.png' });

  await studio.setViewportSize({ width: 1280, height: 800 });
  await studio.emulateMedia({ colorScheme: 'dark' });
  await studio.getByRole('tab', { name: 'Pages' }).click();
  const bg = await studio.evaluate(
    () => getComputedStyle(document.querySelector('header')!).backgroundColor,
  );
  expect(bg).not.toBe('rgb(255, 255, 255)');
  await studio.screenshot({ path: 'e2e-artifacts/edge-dark-pages.png' });
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.screenshot({ path: 'e2e-artifacts/edge-dark-markup.png' });
});

test('mark up: no-ops, tiny drags and leaving mid-edit', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  const anns = () =>
    studio.evaluate(() =>
      (
        window as unknown as {
          __spStudio: {
            project(): { annotations: Array<{ kind: string; text?: string }>; crop: unknown };
          };
        }
      ).__spStudio.project(),
    );
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  const body = (await studio.getByTestId('annotate-body').boundingBox())!;
  const at = (dx: number, dy: number) => ({ x: body.x + dx, y: body.y + dy });

  // Undo, redo and delete with nothing to act on.
  await studio.keyboard.press('Control+z');
  await studio.keyboard.press('Control+y');
  await studio.keyboard.press('Delete');
  expect((await anns()).annotations).toEqual([]);
  await expect(studio.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // A 2 px drag is a click, not a shape; a 10 px crop is too small to mean anything.
  await studio.keyboard.press('r');
  let p = at(300, 200);
  await studio.mouse.move(p.x, p.y);
  await studio.mouse.down();
  await studio.mouse.move(p.x + 2, p.y + 1);
  await studio.mouse.up();
  await studio.keyboard.press('c');
  await studio.mouse.move(p.x, p.y);
  await studio.mouse.down();
  await studio.mouse.move(p.x + 10, p.y + 10);
  await studio.mouse.up();
  expect(await anns()).toEqual({ annotations: [], crop: null });

  // Text: only spaces, or Esc, leaves nothing.
  await studio.keyboard.press('t');
  p = at(400, 300);
  await studio.mouse.click(p.x, p.y);
  await studio.keyboard.type('   ');
  await studio.keyboard.press('Enter');
  await studio.mouse.click(p.x, p.y + 60);
  await studio.keyboard.type('gone');
  await studio.keyboard.press('Escape');
  expect((await anns()).annotations).toEqual([]);

  // Typing, then switching mode without pressing Enter, keeps the text.
  await studio.mouse.click(p.x, p.y + 120);
  await studio.keyboard.type('kept');
  await studio.getByRole('tab', { name: 'Pages' }).click();
  expect((await anns()).annotations).toMatchObject([{ kind: 'text', text: 'kept' }]);

  // Clear all, then undo brings it back.
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.getByRole('button', { name: /Clear all/ }).click();
  expect((await anns()).annotations).toEqual([]);
  await studio.keyboard.press('Control+z');
  expect((await anns()).annotations).toHaveLength(1);

  // Tool keys typed into the text box don't switch tools.
  await studio.keyboard.press('t');
  await studio.mouse.click(p.x, p.y + 200);
  await studio.keyboard.type('rabbit');
  await studio.keyboard.press('Enter');
  await expect(studio.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await anns()).annotations.map((a) => a.text)).toEqual(['kept', 'rabbit']);
});

test('break edits survive switching modes', async ({ context, serviceWorker }) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  const ys = () =>
    studio.evaluate(() =>
      (window as unknown as { __spStudio: { slices(): Array<{ y1: number }> } }).__spStudio
        .slices()
        .map((s) => Math.round(s.y1)),
    );
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  const before = await ys();
  await studio.getByTestId('break').first().hover();
  await studio.getByRole('button', { name: 'Remove break 1' }).click();
  // Removing a break re-flows the pages (the count may stay the same).
  await expect.poll(ys).not.toEqual(before);
  const edited = await ys();
  expect(edited).not.toContain(before[0]);
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.getByRole('tab', { name: 'Pages' }).click();
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  expect(await ys()).toEqual(edited);
  await expect(studio.getByRole('button', { name: 'Reset breaks' })).toBeEnabled();
  await studio.getByRole('button', { name: 'Reset breaks' }).click();
  expect(await ys()).toEqual(before);
});

test('Mark up → Page: watermark on chosen pages, in the preview and the PDF', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  const page = studio.getByRole('complementary', { name: 'Page' });
  await expect(page).toBeVisible();
  await page.getByRole('textbox', { name: 'Watermark text' }).fill('DRAFT ONLY');
  await page.getByRole('radio', { name: 'These pages:' }).check();
  await page.getByRole('textbox', { name: 'Watermark pages' }).fill('2');
  await studio.getByRole('tab', { name: 'Pages' }).click();
  // Exactly one preview page carries it: page 2.
  await expect(studio.getByTestId('watermark-preview')).toHaveCount(1);
  await expect(studio.getByTestId('watermark-preview')).toHaveText('DRAFT ONLY');

  const b64 = (await studio.evaluate(() =>
    (window as unknown as { __spStudio: { pdfBase64(): Promise<string> } }).__spStudio.pdfBase64(),
  )) as string;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(Buffer.from(b64, 'base64')),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  }).promise;
  const textOf = async (n: number) =>
    (await (await pdf.getPage(n)).getTextContent()).items
      .map((it) => ('str' in it ? it.str : ''))
      .join('');
  expect(pdf.numPages).toBeGreaterThan(2);
  expect(await textOf(1)).not.toContain('DRAFT ONLY');
  expect(await textOf(2)).toContain('DRAFT ONLY');

  // Every page, then remove.
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await page.getByRole('radio', { name: 'Every page' }).check();
  await studio.getByRole('tab', { name: 'Pages' }).click();
  await expect(studio.getByTestId('watermark-preview')).toHaveCount(pdf.numPages);
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await page.getByRole('button', { name: 'Remove watermark' }).click();
  await studio.getByRole('tab', { name: 'Pages' }).click();
  await expect(studio.getByTestId('watermark-preview')).toHaveCount(0);
});

test('Mark up → Filter: black & white reaches the PDF; its text stays searchable', async ({
  context,
  serviceWorker,
}) => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const studio = await capture(context, serviceWorker, 'article.html');
  const fonts = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname;
  /** Page 1 of the current PDF: share of pixels that are neither near black nor near white. */
  const page1 = async () => {
    const b64 = (await studio.evaluate(() =>
      (
        window as unknown as { __spStudio: { pdfBase64(): Promise<string> } }
      ).__spStudio.pdfBase64(),
    )) as string;
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(Buffer.from(b64, 'base64')),
      standardFontDataUrl: fonts,
    }).promise;
    const pg = await pdf.getPage(1);
    const text = (await pg.getTextContent()).items
      .map((it) => ('str' in it ? it.str : ''))
      .join('');
    const vp = pg.getViewport({ scale: 3 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    await pg.render({ canvas: canvas as never, viewport: vp }).promise;
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let mid = 0;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      if (v > 40 && v < 215) mid++;
      if (v < 128) ink++;
    }
    return { text, mid: mid / (d.length / 4), ink: ink / (d.length / 4) };
  };
  const original = await page1();
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await studio.getByRole('radio', { name: /^Black & white/ }).check();
  await studio.getByRole('button', { name: 'About Black & white' }).click();
  await expect(studio.getByText(/Sauvola 2000/)).toBeVisible();
  const bw = await page1();
  // Fewer in-between greys (only the edges the PDF viewer smooths), the same text, still ink.
  expect(bw.mid).toBeLessThan(original.mid * 0.6);
  expect(bw.ink).toBeGreaterThan(0.01);
  expect(bw.text).toContain('Article fixture');
  // Remembered, like the other page settings.
  const stored = await serviceWorker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return (settings as { pdf: { filter: string } }).pdf.filter;
  });
  expect(stored).toBe('bw');
});

test('Mark up → Page: presets can be added, removed, restored, and are remembered', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'article.html');
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  const wm = studio.getByRole('group', { name: 'Watermark presets' });
  const text = studio.getByRole('textbox', { name: 'Watermark text' });

  // Watermark: use one, remove a default, save my own.
  await wm.getByRole('button', { name: 'DRAFT', exact: true }).click();
  await expect(text).toHaveValue('DRAFT');
  await wm.getByRole('button', { name: 'Remove preset COPY' }).click();
  await expect(wm.getByRole('button', { name: 'COPY', exact: true })).toHaveCount(0);
  await text.fill('INTERNAL ONLY');
  await wm.getByRole('button', { name: '+ Save' }).click();
  await expect(wm.getByRole('button', { name: 'INTERNAL ONLY', exact: true })).toBeVisible();
  await expect(wm.getByRole('button', { name: '+ Save' })).toBeDisabled(); // already saved

  // Labels: save the footer as a preset, apply it to the header, then remove it.
  const labels = studio.getByRole('group', { name: 'Label presets' });
  await studio.getByRole('textbox', { name: 'Footer left' }).fill('Q3 report');
  await studio.getByRole('textbox', { name: 'Footer center' }).fill('');
  await studio.getByRole('textbox', { name: 'Footer right' }).fill('{page}/{pages}');
  await labels.getByRole('button', { name: '+ Save footer' }).click();
  await expect(labels.getByText('Q3 report | {page}/{pages}')).toBeVisible();
  await studio
    .getByRole('combobox', { name: 'Header preset' })
    .selectOption({ label: 'Q3 report | {page}/{pages}' });
  await expect(studio.getByRole('textbox', { name: 'Header left' })).toHaveValue('Q3 report');

  // Remembered after a reload.
  await studio.waitForTimeout(500);
  await studio.reload();
  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await expect(wm.getByRole('button', { name: 'INTERNAL ONLY', exact: true })).toBeVisible();
  await expect(wm.getByRole('button', { name: 'COPY', exact: true })).toHaveCount(0);
  await labels.getByRole('button', { name: 'Remove preset Q3 report | {page}/{pages}' }).click();
  await expect(labels.getByText('Q3 report | {page}/{pages}')).toHaveCount(0);

  // Defaults come back on request; my own stay.
  await wm.getByRole('button', { name: 'Restore defaults (1)' }).click();
  await expect(wm.getByRole('button', { name: 'COPY', exact: true })).toBeVisible();
  await expect(wm.getByRole('button', { name: 'INTERNAL ONLY', exact: true })).toBeVisible();
  await expect(wm.getByRole('button', { name: /Restore defaults/ })).toHaveCount(0);
});

test('PDF quality presets order the file sizes; Details shows the numbers behind them', async ({
  context,
  serviceWorker,
}) => {
  const studio = await capture(context, serviceWorker, 'tall-image.html');
  const pdfSize = async () =>
    (
      (await studio.evaluate(() =>
        (
          window as unknown as { __spStudio: { pdfBase64(): Promise<string> } }
        ).__spStudio.pdfBase64(),
      )) as string
    ).length;
  await studio.getByRole('button', { name: 'More options' }).click();
  const quality = studio.getByRole('combobox', { name: 'PDF quality' });
  const sizes: Record<string, number> = {};
  for (const q of ['Compact', 'Best', 'Lossless']) {
    await quality.selectOption({ label: q });
    sizes[q] = await pdfSize();
  }
  expect(sizes.Compact!).toBeLessThan(sizes.Best!);
  expect(sizes.Best!).toBeLessThan(sizes.Lossless!);

  // Details: open with the header button, values and calculations shown, one row per page.
  await studio.getByRole('button', { name: 'Details', exact: true }).click();
  const panel = studio.getByRole('complementary', { name: 'Details' });
  await expect(panel.getByText('PDF quality', { exact: true })).toBeVisible();
  await expect(panel.getByText('Lossless', { exact: true })).toBeVisible();
  await expect(panel.getByText(/^box width ÷ content width = /)).toBeVisible();
  await expect(panel.getByText(/^dpr × 72 ÷ s = 1 × 72 ÷ /)).toBeVisible();
  const pages = await studio.evaluate(
    () => (window as unknown as { __spStudio: { slices(): unknown[] } }).__spStudio.slices().length,
  );
  await expect(panel.getByRole('table', { name: 'Pages' }).locator('tbody tr')).toHaveCount(pages);
  // Forced cuts (the tall image) are counted and marked.
  await expect(
    panel
      .getByText('Forced cuts')
      .locator('..')
      .getByText(/^[1-9]/),
  ).toBeVisible();
  // Copy all as text.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel.getByRole('button', { name: 'Copy all as text' }).click();
  await expect(panel.getByRole('status')).toHaveText('Copied');
  // I toggles it; it stays closed after a reload.
  await studio.keyboard.press('i');
  await expect(panel).toHaveCount(0);
  await studio.reload();
  await expect(studio.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
});

// Needs the model files: OCR_BUNDLE=<unpacked bundle dir> (served by the fixture server).
test.describe('text recognition', () => {
  test.skip(!process.env.OCR_BUNDLE, 'OCR_BUNDLE not set');

  test('a page drawn in a canvas: download the model once, then its text is searchable', async ({
    context,
    serviceWorker,
  }) => {
    test.setTimeout(240_000);
    await serviceWorker.evaluate(() =>
      chrome.storage.local.set({ e2eOcrBase: 'http://localhost:5177/ocr-bundle/' }),
    );
    const studio = await capture(context, serviceWorker, 'canvas-text.html');
    const card = studio.getByRole('group', { name: 'Text recognition' });
    await expect(card).toContainText(/pages? without text of their own/);
    await card.getByRole('button', { name: /^Download model \(\d+\.\d MB\)$/ }).click();
    await expect(card).toContainText('Their text is read when you save', { timeout: 120_000 });

    const b64 = (await studio.evaluate(() =>
      (
        window as unknown as { __spStudio: { pdfBase64(): Promise<string> } }
      ).__spStudio.pdfBase64(),
    )) as string;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(Buffer.from(b64, 'base64')),
      standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
        .pathname,
    }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++)
      text += (await (await pdf.getPage(i)).getTextContent()).items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ');
    expect(text).toContain('Revenue grew 14%');
    expect(text).toContain('Quarterly report 2026');
    expect(text.replace(/\s+/g, '')).toContain('季度报告');

    // Kept on this computer: a new Studio finds the model ready.
    await studio.reload();
    await expect(studio.getByRole('group', { name: 'Text recognition' })).toContainText(
      'Their text is read when you save',
    );
  });
});
