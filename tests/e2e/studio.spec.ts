import { createCanvas } from '@napi-rs/canvas';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import type { PageSlice } from '../../packages/core/src/paginate';
import { expect, test, FIXTURES } from './fixtures';

interface StudioHook {
  slices(): PageSlice[];
  crop(): { x0: number; x1: number; cropped: boolean };
  warnings(): string[];
  pdfBase64(): Promise<string>;
}

/** Captures a fixture, waits for the Studio tab it opens, and returns both pages. */
async function captureToStudio(context: BrowserContext, sw: Worker, path: string, width = 1280) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    const hook = (globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } })
      .__spTest;
    await hook.capture(tab!.id!);
  }, `${FIXTURES}/${path}`);
  const studio = await studioPromise;
  await studio.waitForFunction(
    () => 'slices' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    {
      timeout: 60_000,
    },
  );
  const slices = await studio.evaluate(() =>
    (window as unknown as { __spStudio: StudioHook }).__spStudio.slices(),
  );
  const warnings = await studio.evaluate(() =>
    (window as unknown as { __spStudio: StudioHook }).__spStudio.warnings(),
  );
  return { page, studio, slices, warnings };
}

async function pdfOf(studio: Page): Promise<Uint8Array> {
  const b64 = await studio.evaluate(() =>
    (window as unknown as { __spStudio: StudioHook }).__spStudio.pdfBase64(),
  );
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Text line boxes of the captured page, in document coordinates (TESTING §3). */
function lineBoxes(page: Page) {
  return page.evaluate(() => {
    const out: Array<[number, number]> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue?.trim() || !n.parentElement?.checkVisibility()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        if (r.height) out.push([r.top + scrollY, r.bottom + scrollY]);
    }
    return out;
  });
}

/** pdf.js needs its own font data to draw the standard 14 fonts (our Helvetica footer). */
const STANDARD_FONTS = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  .pathname;

async function renderPages(bytes: Uint8Array, name: string, pages: number[]) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: STANDARD_FONTS })
    .promise;
  mkdirSync('e2e-artifacts', { recursive: true });
  for (const n of pages) {
    if (n > pdf.numPages) continue;
    const p = await pdf.getPage(n);
    const vp = p.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    await p.render({ canvas: canvas as never, viewport: vp }).promise;
    writeFileSync(`e2e-artifacts/${name}-pdf-p${n}.png`, canvas.toBuffer('image/png'));
  }
}

test('article: Studio opens, no break cuts a text line, PDF has one A4 page per slice', async ({
  context,
  serviceWorker,
}) => {
  const { page, studio, slices, warnings } = await captureToStudio(
    context,
    serviceWorker,
    'article.html',
  );
  expect(warnings).toEqual([]);
  expect(slices.length).toBeGreaterThanOrEqual(3);
  const lines = await lineBoxes(page);
  for (const s of slices.slice(0, -1)) {
    expect(lines.filter(([a, b]) => s.y1 > a + 0.5 && s.y1 < b - 0.5)).toEqual([]);
    expect(['section', 'paragraph', 'listItem', 'tableRow', 'line']).toContain(s.breakKind);
  }
  const bytes = await pdfOf(studio);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(slices.length);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  expect(pdf.getTitle()).toBe('Article fixture');
  await renderPages(bytes, 'article', [1, 2]);
});

test('tall image: forced cut with overlap and a warning', async ({ context, serviceWorker }) => {
  const { page, studio, slices, warnings } = await captureToStudio(
    context,
    serviceWorker,
    'tall-image.html',
  );
  const img = await page.evaluate(() => {
    const r = document.getElementById('photo')!.getBoundingClientRect();
    return { y0: r.top + scrollY, y1: r.bottom + scrollY };
  });
  const forced = slices.filter((s) => s.breakKind === 'forced');
  expect(forced.length).toBeGreaterThanOrEqual(2);
  for (const s of forced) expect(s.y1 > img.y0 && s.y1 < img.y1).toBe(true);
  expect(slices.some((s) => s.overlapTop > 0)).toBe(true);
  expect(warnings.some((w) => /an element taller than one page was split/.test(w))).toBe(true);
  const lines = await lineBoxes(page);
  for (const s of slices.slice(0, -1)) {
    expect(lines.filter(([a, b]) => s.y1 > a + 0.5 && s.y1 < b - 0.5)).toEqual([]);
  }
  await renderPages(await pdfOf(studio), 'tall-image', [1, 2, 3]);
});

test('sticky header and inner scroller go through the Studio to a PDF', async ({
  context,
  serviceWorker,
}) => {
  for (const path of ['sticky-header.html', 'inner-scroll.html']) {
    const { studio, slices } = await captureToStudio(context, serviceWorker, path);
    expect(slices.length).toBeGreaterThanOrEqual(2);
    const bytes = await pdfOf(studio);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(slices.length);
    await renderPages(bytes, path.replace('.html', ''), [1, 2]);
    await studio.close();
  }
});

test('wide margins: a 700 px column in a 1920 px page is cropped and stays readable', async ({
  context,
  serviceWorker,
}) => {
  const { studio, warnings } = await captureToStudio(
    context,
    serviceWorker,
    'wide-margins.html',
    1920,
  );
  const crop = await studio.evaluate(() =>
    (window as unknown as { __spStudio: StudioHook }).__spStudio.crop(),
  );
  expect(crop.cropped).toBe(true);
  expect(crop.x1 - crop.x0).toBeLessThan(760);
  expect(crop.x0).toBeGreaterThan(580);
  expect(warnings.filter((w) => w.startsWith('Text will be small'))).toEqual([]);
  // With cropping off, the same page prints too small, and the Studio says so.
  await studio.getByRole('button', { name: 'More options' }).click();
  await studio.getByRole('combobox', { name: 'Crop sides' }).selectOption('off');
  await expect
    .poll(() =>
      studio.evaluate(() =>
        (window as unknown as { __spStudio: StudioHook }).__spStudio.warnings(),
      ),
    )
    .toContainEqual(expect.stringMatching(/^Text will be small \(≈\d\.\d pt\)/));
  await studio.getByRole('combobox', { name: 'Crop sides' }).selectOption('auto');
});
