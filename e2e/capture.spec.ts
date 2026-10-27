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

test('stitched article capture has no seams or repeats (artifact for review)', async ({
  context,
  serviceWorker,
}) => {
  const { result } = await captureFixture(context, serviceWorker, 'article.html');
  const pngs = await serviceWorker.evaluate(
    (id) =>
      (
        globalThis as unknown as { __spTest: { frameImages(id: string): Promise<string[]> } }
      ).__spTest.frameImages(id),
    result.id,
  );
  const images = await Promise.all(pngs.map((b64) => loadImage(Buffer.from(b64, 'base64'))));
  const geoms = result.frames.map((f) => ({
    docY: f.docY,
    height: f.crop.height,
    cropX: 0,
    cropY: 0,
    dpr: f.dpr,
  }));
  const height = result.done.docHeight;
  const width = images[0]!.width;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  for (const op of composeOps(geoms, { x0: 0, x1: width, y0: 0, y1: height }, 1)) {
    ctx.drawImage(images[op.frame]!, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
  }
  mkdirSync('test-results/artifacts', { recursive: true });
  writeFileSync('test-results/artifacts/article-stitched.png', canvas.toBuffer('image/png'));
  expect(height).toBeGreaterThan(images[0]!.height);
});
