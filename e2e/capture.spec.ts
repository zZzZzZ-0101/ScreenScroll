import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { composeOps } from '../packages/core/src/compose';
import { expect, test, FIXTURES } from './fixtures';

interface CaptureResult {
  id: string;
  done: { status: string; docHeight: number; warnings: string[] };
  frames: Array<{
    index: number;
    docY: number;
    dpr: number;
    crop: { height: number };
    imageWidth: number;
  }>;
}

async function captureFixture(
  context: import('@playwright/test').BrowserContext,
  serviceWorker: import('@playwright/test').Worker,
  path: string,
): Promise<{ result: CaptureResult; page: import('@playwright/test').Page }> {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/${path}`);
  await page.bringToFront();
  const result = await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    const hook = (globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } })
      .__spTest;
    return hook.capture(tab!.id!);
  }, `${FIXTURES}/${path}`);
  return { result: result as CaptureResult, page };
}

test('full-page capture of the article stores contiguous frames and restores the page', async ({
  context,
  serviceWorker,
}) => {
  const { result, page } = await captureFixture(context, serviceWorker, 'article.html');
  expect(result.done.warnings).toEqual([]);
  expect(result.done.status).toBe('complete');

  const { scrollHeight, innerHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    innerHeight,
  }));
  const frames = result.frames;
  expect(frames.length).toBe(Math.ceil(scrollHeight / innerHeight));
  expect(frames[0]!.docY).toBe(0);
  // Every frame starts within the previous one: no gaps in coverage.
  for (let i = 1; i < frames.length; i++) {
    expect(frames[i]!.docY).toBeGreaterThan(frames[i - 1]!.docY);
    expect(frames[i]!.docY).toBeLessThanOrEqual(frames[i - 1]!.docY + frames[i - 1]!.crop.height);
  }
  expect(frames.at(-1)!.docY + frames.at(-1)!.crop.height).toBe(scrollHeight);
  expect(frames[0]!.dpr).toBeCloseTo(1, 2);

  // Restore: scroll position back at the top, no injected nodes or styles left behind.
  const after = await page.evaluate(() => ({
    scrollTop: document.scrollingElement!.scrollTop,
    styles: document.querySelectorAll('style').length,
    inline: [...document.querySelectorAll<HTMLElement>('[style]')].length,
    lastChild: document.documentElement.lastElementChild?.tagName,
  }));
  expect(after).toEqual({ scrollTop: 0, styles: 1, inline: 0, lastChild: 'BODY' });
});

/** Stitches stored frames with the core compositor; also saves the PNG for human review. */
async function stitch(
  serviceWorker: import('@playwright/test').Worker,
  result: CaptureResult,
  name: string,
) {
  const pngs = await serviceWorker.evaluate(
    (id) =>
      (
        globalThis as unknown as { __spTest: { frameImages(id: string): Promise<string[]> } }
      ).__spTest.frameImages(id),
    result.id,
  );
  const images = await Promise.all(pngs.map((b64) => loadImage(Buffer.from(b64, 'base64'))));
  const f0 = result.frames[0]!;
  const geoms = result.frames.map((f) => ({
    docY: f.docY,
    height: f.crop.height,
    cropX: f.crop.x * f.dpr,
    cropY: f.crop.y * f.dpr,
    dpr: f.dpr,
  }));
  const width = Math.round(f0.crop.width);
  const height = result.done.docHeight;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  for (const op of composeOps(geoms, { x0: 0, x1: width, y0: 0, y1: height }, 1)) {
    ctx.drawImage(images[op.frame]!, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
  }
  mkdirSync('e2e-artifacts', { recursive: true });
  writeFileSync(`e2e-artifacts/${name}-stitched.png`, canvas.toBuffer('image/png'));
  const data = ctx.getImageData(0, 0, width, height).data;
  /** Rows whose pixel at column x is within 12 of the given colour. */
  const rowsWithColour = (x: number, [r, g, b]: [number, number, number]) => {
    const rows: number[] = [];
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (Math.abs(data[i]! - r) + Math.abs(data[i + 1]! - g) + Math.abs(data[i + 2]! - b) < 36)
        rows.push(y);
    }
    return rows;
  };
  const colourAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  return { width, height, rowsWithColour, colourAt };
}

/** Number of separate runs in a sorted list of row numbers. */
const runs = (rows: number[]) => rows.filter((y, i) => i === 0 || y !== rows[i - 1]! + 1).length;

test('stitched article capture is written for review', async ({ context, serviceWorker }) => {
  const { result } = await captureFixture(context, serviceWorker, 'article.html');
  const { height } = await stitch(serviceWorker, result, 'article');
  expect(height).toBe(result.done.docHeight);
});

test('sticky and fixed headers appear once; bottom bar is absent', async ({
  context,
  serviceWorker,
}) => {
  const { result, page } = await captureFixture(context, serviceWorker, 'sticky-header.html');
  expect(result.done.status).toBe('complete');
  expect(result.frames.length).toBeGreaterThan(2);
  const img = await stitch(serviceWorker, result, 'sticky-header');
  const red = img.rowsWithColour(5, [0xc0, 0x39, 0x2b]);
  expect(runs(red)).toBe(1);
  expect(red[0]).toBe(0);
  expect(red.length).toBe(48);
  // Sample right of the label text, which would otherwise split the band.
  expect(runs(img.rowsWithColour(1000, [0xf1, 0xc4, 0x0f]))).toBe(1);
  expect(img.rowsWithColour(5, [0x2c, 0x3e, 0x50])).toEqual([]);
  // Restored: the page's own styles are back.
  const pos = await page.evaluate(
    () => getComputedStyle(document.getElementById('sticky')!).position,
  );
  expect(pos).toBe('sticky');
});

test('inner scroller: only the panel is captured, whole content, no repeated chrome', async ({
  context,
  serviceWorker,
}) => {
  const { result, page } = await captureFixture(context, serviceWorker, 'inner-scroll.html');
  expect(result.done.status).toBe('complete');
  const panel = await page.evaluate(() => {
    const el = document.getElementById('panel')!;
    return { scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollTop: el.scrollTop };
  });
  expect(result.done.docHeight).toBe(panel.scrollHeight);
  expect(panel.scrollTop).toBe(0);
  const img = await stitch(serviceWorker, result, 'inner-scroll');
  expect(img.width).toBe(panel.clientWidth);
  expect(img.rowsWithColour(5, [0x34, 0x49, 0x5e])).toEqual([]); // top bar
  expect(img.rowsWithColour(5, [0xec, 0xf0, 0xf1])).toEqual([]); // sidebar
});

test('lazy images are loaded in every frame (none blank)', async ({ context, serviceWorker }) => {
  const { result, page } = await captureFixture(context, serviceWorker, 'lazy-images.html');
  expect(result.done.warnings).toEqual([]);
  const rects = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('img.t')].map((img) => {
      const r = img.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + scrollY, h: r.height };
    }),
  );
  expect(rects).toHaveLength(12);
  const img = await stitch(serviceWorker, result, 'lazy-images');
  // Sample near the top, middle and bottom: a frame seam can cut through an image.
  for (const r of rects) {
    for (const f of [0.1, 0.5, 0.9]) {
      expect(img.colourAt(Math.round(r.x), Math.round(r.y + f * r.h))).toEqual([0x8e, 0x44, 0xad]);
    }
  }
  // Restored: data-src images are back to their placeholder only if the page had not loaded them.
  const loading = await page.evaluate(() =>
    [...document.querySelectorAll('img[loading]')].map((i) => i.getAttribute('loading')),
  );
  expect(new Set(loading)).toEqual(new Set(['lazy']));
});

/** Page state that capture must leave untouched once it has finished, however it ended. */
async function pageState(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    scrollTop: document.scrollingElement!.scrollTop,
    styles: document.querySelectorAll('style').length,
    inline: [...document.querySelectorAll('[style]')].map(
      (e) => e.id + ':' + e.getAttribute('style'),
    ),
    lastChild: document.documentElement.lastElementChild?.tagName,
    sticky: getComputedStyle(document.getElementById('sticky')!).position,
    cookie: getComputedStyle(document.getElementById('cookie')!).visibility,
  }));
}

type Hook = {
  start(tabId: number): Promise<string>;
  wait(id: string): Promise<CaptureResult>;
  failGrabAt(i: number | null): void;
};

test('Esc cancels mid-capture and restores the page', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/sticky-header.html`);
  await page.bringToFront();
  const before = await pageState(page);
  const url = `${FIXTURES}/sticky-header.html`;
  const id = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return (globalThis as unknown as { __spTest: Hook }).__spTest.start(tab!.id!);
  }, url);
  // Wait until at least one frame is stored, then cancel.
  await expect
    .poll(() => page.evaluate(() => document.scrollingElement!.scrollTop), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const result = await serviceWorker.evaluate(
    (i) => (globalThis as unknown as { __spTest: Hook }).__spTest.wait(i),
    id,
  );
  expect(result.done.status).toBe('cancelled');
  expect(await pageState(page)).toEqual(before);
});

test('a failed frame grab ends with an error warning and restores the page', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/sticky-header.html`);
  await page.bringToFront();
  const before = await pageState(page);
  const url = `${FIXTURES}/sticky-header.html`;
  const result = await serviceWorker.evaluate(async (u) => {
    const hook = (globalThis as unknown as { __spTest: Hook }).__spTest;
    hook.failGrabAt(2);
    const [tab] = await chrome.tabs.query({ url: u });
    return hook.wait(await hook.start(tab!.id!));
  }, url);
  expect(result.done.status).toBe('error');
  expect(result.done.warnings).toEqual(['Capture failed: Injected test failure']);
  expect(result.frames).toHaveLength(2);
  expect(await pageState(page)).toEqual(before);
});
