import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, FIXTURES } from './fixtures';

const STANDARD_FONTS = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  .pathname;

interface Slice {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  overlapTop: number;
}
const slices = (studio: import('@playwright/test').Page) =>
  studio.evaluate(() =>
    (window as unknown as { __spStudio: { slices(): Slice[] } }).__spStudio.slices(),
  );

test('a document viewer: one PDF page per document page, cropped to the page', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/doc-viewer.html`;
  await page.goto(url);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, url);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await expect(studio.getByTestId('sheets')).toContainText('6 pages', { timeout: 60_000 });

  // Where the sheets are on the page, in the viewer's coordinates.
  const sheets = await page.evaluate(() => {
    const v = document.getElementById('viewer')!;
    const vr = v.getBoundingClientRect();
    return [...document.querySelectorAll('.sheet')].map((s) => {
      const r = s.getBoundingClientRect();
      return {
        x0: r.left - vr.left,
        x1: r.right - vr.left,
        y0: r.top - vr.top,
        y1: r.bottom - vr.top,
      };
    });
  });
  const got = await slices(studio);
  expect(got).toHaveLength(6);
  got.forEach((s, i) => {
    expect(Math.abs(s.y0 - sheets[i]!.y0)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.y1 - sheets[i]!.y1)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.x0 - sheets[i]!.x0)).toBeLessThanOrEqual(3);
    expect(Math.abs(s.x1 - sheets[i]!.x1)).toBeLessThanOrEqual(3);
    expect(s.overlapTop).toBe(0);
  });
  await studio.screenshot({ path: 'e2e-artifacts/doc-viewer-studio.png' });

  // Diagnostics: Details shows what page detection read, and copies it as a test case.
  await studio.getByRole('button', { name: 'Details' }).click();
  const details = studio.getByRole('complementary', { name: 'Details' });
  await expect(details.getByText('Document pages', { exact: true })).toBeVisible();
  await expect(details.getByText('Viewer background')).toBeVisible();
  await expect(details.getByText(/\d+% · fit 0\.\d{3}/).first()).toBeVisible();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await details.getByRole('button', { name: 'Copy page detection as a test case' }).click();
  const copied = JSON.parse(await studio.evaluate(() => navigator.clipboard.readText()));
  expect(copied.evidence.gapRuns.length).toBeGreaterThan(10);
  expect(copied.readings[0].sheets).toHaveLength(6);
  await studio.getByRole('button', { name: 'Close details' }).click();

  // Breaks are the document's; editing them is off while following them.
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  await expect(studio.getByText(/The breaks follow the document/)).toBeVisible();
  await expect(studio.getByRole('button', { name: 'Remove break 1' })).toHaveCount(0);
  await studio.getByRole('tab', { name: 'Pages' }).click();

  // The PDF: six pages, each showing one whole sheet and none of the dark background.
  const dl = studio.waitForEvent('download');
  await studio.getByRole('button', { name: 'Save PDF' }).click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: STANDARD_FONTS }).promise;
  expect(pdf.numPages).toBe(6);
  for (let i = 1; i <= 6; i++) {
    const text = (await (await pdf.getPage(i)).getTextContent()).items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ');
    expect(text).toContain(`Document page ${i}`);
    expect(text).toContain(`End of document page ${i}.`);
    expect(text).not.toContain(`Document page ${i + 1}`);
    // As the original: no page label of ours on the page.
    expect(text).not.toContain('localhost');
  }
  // As the original: the page shape (760 × 1075) is A4, so the paper is A4 portrait, and the
  // page image fills it edge to edge.
  const first = await pdf.getPage(1);
  const [, , pw, ph] = first.view;
  expect(pw).toBeCloseTo(595.28, 0);
  expect(ph).toBeCloseTo(841.89, 0);
  await expect(studio.getByTestId('sheets')).toContainText('As the original · A4');
  for (const n of [1, 6]) {
    const pg = await pdf.getPage(n);
    const v = pg.getViewport({ scale: 1 });
    const c = createCanvas(Math.ceil(v.width), Math.ceil(v.height));
    await pg.render({ canvas: c as never, viewport: v }).promise;
    writeFileSync(`e2e-artifacts/doc-viewer-p${n}.png`, c.toBuffer('image/png'));
  }
  const p3 = await pdf.getPage(3);
  const vp = p3.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await p3.render({ canvas: canvas as never, viewport: vp }).promise;
  // No dark viewer background anywhere at the page's left and right edges of the image.
  const ctx = canvas.getContext('2d');
  const px = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data;
  const mid = Math.round(vp.height / 2);
  expect(px(Math.round(vp.width / 2), mid)[0]).toBeGreaterThan(200);
  // Edge to edge: the corners are the page's own white, not a margin of another colour, and
  // the 1 px edge columns are not the viewer's dark background.
  for (const x of [1, Math.round(vp.width) - 2]) expect(px(x, mid)[0]).toBeGreaterThan(200);
  writeFileSync('e2e-artifacts/doc-viewer-p3.png', canvas.toBuffer('image/png'));

  // Turned off, ordinary smart breaks come back.
  await studio.getByRole('checkbox', { name: 'One PDF page per document page' }).uncheck();
  await expect.poll(async () => (await slices(studio)).some((s) => s.x0 < 10)).toBe(true);
});

test('document pages: ranked readings, then edit by hand with ±1 px steps, back to the best reading', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/doc-viewer.html`;
  await page.goto(url);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, url);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await expect(studio.getByTestId('sheets')).toContainText('6 pages', { timeout: 60_000 });
  // The ways to read the pages, best first with its probability; the gaps reading is chosen.
  const doc = studio.getByTestId('sheets');
  const gaps = doc.getByRole('radio', { name: /Found from the gaps/ });
  await expect(gaps).toBeChecked();
  const pct = Number(/(\d+)%/.exec((await doc.textContent()) ?? '')![1]);
  expect(pct).toBeGreaterThanOrEqual(50);

  await doc.getByRole('button', { name: 'Edit pages' }).click();
  const card = studio.getByTestId('sheet-grid');
  await expect(doc).toContainText('6 pages');
  // Prefilled with the detected grid: 1075 px pages, 18 px gaps.
  await expect(card.getByRole('spinbutton', { name: 'Page height' })).toHaveValue('1075');
  await expect(card.getByRole('spinbutton', { name: 'Gap between pages' })).toHaveValue('18');
  // ±1 px steps, for the last pixel (a dark line at an edge).
  await card.getByRole('button', { name: 'Right edge (x) −1' }).click();
  const right = Number(await card.getByRole('spinbutton', { name: 'Right edge (x)' }).inputValue());
  expect((await slices(studio))[0]!.x1).toBeCloseTo(right, 0);

  // Half-height pages: twice as many, each 500 px, starting at the same top.
  await card.getByRole('spinbutton', { name: 'Page height' }).fill('500');
  await expect(doc).toContainText(/1[23] pages/);
  await expect(doc.getByRole('radio', { name: 'Set by hand' })).toBeChecked();
  const got = await slices(studio);
  expect(got[0]!.y1 - got[0]!.y0).toBe(500);
  expect(got[1]!.y0 - got[0]!.y1).toBe(18);
  expect(got.every((s) => s.overlapTop === 0)).toBe(true);
  await doc.screenshot({ path: 'e2e-artifacts/sheet-grid.png' });

  await card.getByRole('button', { name: 'Back to the best reading' }).click();
  await expect(studio.getByTestId('sheet-grid')).toHaveCount(0);
  await expect(gaps).toBeChecked();
  expect(await slices(studio)).toHaveLength(6);
});

test('document pages: drag a page edge on the strip and the page grid follows', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const url = `${FIXTURES}/doc-viewer.html`;
  await page.goto(url);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ active: true, url: u });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, url);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await expect(studio.getByTestId('sheets')).toContainText('6 pages', { timeout: 60_000 });
  await studio.getByRole('tab', { name: 'Breaks' }).click();
  await expect(studio.getByTestId('sheet-outline')).toHaveCount(6);
  await studio.waitForTimeout(500);
  await studio.screenshot({ path: 'e2e-artifacts/sheet-drag.png' });

  const before = await slices(studio);
  const h0 = before[0]!.y1 - before[0]!.y0;
  // Display px per CSS px, from the first outline.
  const outline = (await studio
    .getByTestId('sheet-outline')
    .first()
    .locator('div')
    .first()
    .boundingBox())!;
  const k = outline.height / h0;
  const edge = studio.getByTestId('sheet-edge-bottom-0');
  await edge.scrollIntoViewIfNeeded();
  const box = (await edge.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await studio.mouse.move(x, y);
  await studio.mouse.down();
  await studio.mouse.move(x, y - 30 * k, { steps: 5 });
  await studio.mouse.up();
  // Every page is now about 30 px shorter, and the card says the pages are set by hand.
  const after = await slices(studio);
  expect(Math.abs(after[0]!.y1 - after[0]!.y0 - (h0 - 30))).toBeLessThanOrEqual(2);
  expect(Math.abs(after[2]!.y1 - after[2]!.y0 - (h0 - 30))).toBeLessThanOrEqual(2);
  await studio.getByRole('tab', { name: 'Pages' }).click();
  await expect(
    studio.getByTestId('sheets').getByRole('radio', { name: 'Set by hand' }),
  ).toBeChecked();
  // One drag is one undo step.
  await studio.keyboard.press('Control+z');
  await expect
    .poll(async () => (await slices(studio))[0]!.y1 - (await slices(studio))[0]!.y0)
    .toBe(h0);
});
