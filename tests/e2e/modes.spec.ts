import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { composeOps } from '../../packages/core/src/compose';
import { expect, test, FIXTURES } from './fixtures';

interface Frame {
  docY: number;
  dpr: number;
  crop: { x: number; y: number; width: number; height: number };
}
interface Result {
  id: string;
  done: { status: string; docWidth: number; docHeight: number; warnings: string[] };
  frames: Frame[];
}
type Hook = {
  start(tabId: number, mode: string, opts?: object): Promise<string>;
  wait(id: string): Promise<Result>;
  frameImages(id: string): Promise<string[]>;
};
const hook = (sw: Worker) => ({
  start: (url: string, mode: string, opts: object = {}) =>
    sw.evaluate(
      async ([u, m, o]) => {
        const [tab] = await chrome.tabs.query({ active: true, url: u as string });
        return (globalThis as unknown as { __spTest: Hook }).__spTest.start(
          tab!.id!,
          m as string,
          o as object,
        );
      },
      [url, mode, opts] as const,
    ),
  wait: (id: string) =>
    sw.evaluate((i) => (globalThis as unknown as { __spTest: Hook }).__spTest.wait(i), id),
});

async function open(context: BrowserContext, path: string): Promise<{ page: Page; url: string }> {
  const page = await context.newPage();
  const url = `${FIXTURES}/${path}`;
  await page.goto(url);
  await page.bringToFront();
  return { page, url };
}

/** Stitches stored frames with the core compositor (region-relative). */
async function stitch(sw: Worker, r: Result, name: string) {
  const pngs = await sw.evaluate(
    (id) => (globalThis as unknown as { __spTest: Hook }).__spTest.frameImages(id),
    r.id,
  );
  const images = await Promise.all(pngs.map((b) => loadImage(Buffer.from(b, 'base64'))));
  const w = Math.round(r.done.docWidth);
  const h = Math.round(r.done.docHeight);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const geoms = r.frames.map((f) => ({
    docY: f.docY,
    height: f.crop.height,
    cropX: f.crop.x * f.dpr,
    cropY: f.crop.y * f.dpr,
    dpr: f.dpr,
  }));
  // Each frame's crop starts at its own x; x0 = 0 in region coordinates.
  for (const op of composeOps(geoms, { x0: 0, x1: w, y0: 0, y1: h }, 1)) {
    ctx.drawImage(images[op.frame]!, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
  }
  mkdirSync('e2e-artifacts', { recursive: true });
  writeFileSync(`e2e-artifacts/${name}.png`, canvas.toBuffer('image/png'));
  return ctx.getImageData(0, 0, w, h).data;
}

/** Mean absolute difference (0–255) between our stitch and Playwright's own screenshot. */
async function diffAgainstScreenshot(
  page: Page,
  data: Uint8ClampedArray,
  clip: { x: number; y: number; width: number; height: number },
) {
  await page.evaluate(() => scrollTo(0, 0));
  const shot = await loadImage(await page.screenshot({ fullPage: true, clip }));
  const c = createCanvas(clip.width, clip.height);
  c.getContext('2d').drawImage(shot, 0, 0);
  const ref = c.getContext('2d').getImageData(0, 0, clip.width, clip.height).data;
  let sum = 0;
  for (let i = 0; i < ref.length; i += 4)
    sum +=
      Math.abs(ref[i]! - data[i]!) +
      Math.abs(ref[i + 1]! - data[i + 1]!) +
      Math.abs(ref[i + 2]! - data[i + 2]!);
  return sum / ((ref.length / 4) * 3);
}

test('selection: drag past the bottom edge auto-scrolls; result matches the page pixels', async ({
  context,
  serviceWorker,
}) => {
  const { page, url } = await open(context, 'article.html');
  const id = await hook(serviceWorker).start(url, 'selection');
  await page.waitForTimeout(300);
  await page.mouse.move(300, 150);
  await page.mouse.down();
  await page.mouse.move(900, 790, { steps: 10 }); // within 36 px of the bottom edge
  await page.waitForTimeout(800); // auto-scroll runs
  await page.mouse.move(900, 600, { steps: 5 });
  await page.mouse.up();
  const scrolled = await page.evaluate(() => scrollY);
  expect(scrolled).toBeGreaterThan(100);
  await page.keyboard.press('Enter');
  const r = await hook(serviceWorker).wait(id);
  expect(r.done.status).toBe('complete');
  expect(r.done.docWidth).toBe(600);
  expect(r.done.docHeight).toBeCloseTo(600 + scrolled - 150, 0);
  expect(r.frames.length).toBeGreaterThanOrEqual(1);
  const data = await stitch(serviceWorker, r, 'selection');
  const diff = await diffAgainstScreenshot(page, data, {
    x: 300,
    y: 150,
    width: 600,
    height: Math.round(r.done.docHeight),
  });
  expect(diff).toBeLessThan(2);
});

test('region near the bottom of the page: clamped scroll, correct crop', async ({
  context,
  serviceWorker,
}) => {
  const { page, url } = await open(context, 'article.html');
  const H = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  const region = { x0: 200, x1: 1000, y0: H - 1300, y1: H - 100 };
  const r = await hook(serviceWorker).wait(
    await hook(serviceWorker).start(url, 'selection', { region }),
  );
  expect(r.done.docHeight).toBe(1200);
  const data = await stitch(serviceWorker, r, 'region-bottom');
  const diff = await diffAgainstScreenshot(page, data, {
    x: 200,
    y: H - 1300,
    width: 800,
    height: 1200,
  });
  expect(diff).toBeLessThan(2);
});

test('element: hover, climb to the parent with ↑, Enter captures exactly that element', async ({
  context,
  serviceWorker,
}) => {
  const { page, url } = await open(context, 'article.html');
  await page.evaluate(() => document.querySelector('figure')!.scrollIntoView({ block: 'center' }));
  const svg = await page.locator('figure svg').first().boundingBox();
  const id = await hook(serviceWorker).start(url, 'element');
  await page.waitForTimeout(300);
  await page.mouse.move(svg!.x + 20, svg!.y + 20);
  await page.keyboard.press('ArrowUp'); // svg → figure
  await page.keyboard.press('Enter');
  const r = await hook(serviceWorker).wait(id);
  const fig = await page.evaluate(() => {
    const b = document.querySelector('figure')!.getBoundingClientRect();
    return { w: b.width, h: b.height, y: b.top + scrollY, x: b.left };
  });
  expect(r.done.status).toBe('complete');
  expect(r.done.docWidth).toBeCloseTo(fig.w, 0);
  expect(r.done.docHeight).toBeCloseTo(fig.h, 0);
  const data = await stitch(serviceWorker, r, 'element-figure');
  const diff = await diffAgainstScreenshot(page, data, {
    x: Math.round(fig.x),
    y: Math.round(fig.y),
    width: Math.round(fig.w),
    height: Math.round(fig.h),
  });
  expect(diff).toBeLessThan(2);
});

test('element that scrolls, and the scroll-area picker, capture the whole panel', async ({
  context,
  serviceWorker,
}) => {
  for (const mode of ['element', 'pick-scroller']) {
    const { page, url } = await open(context, 'inner-scroll.html');
    const panel = await page.locator('#panel').boundingBox();
    const id = await hook(serviceWorker).start(url, mode);
    await page.waitForTimeout(300);
    // element mode: point at the panel itself (its padding); scroll-area mode: at a message
    // inside it, which resolves to the panel.
    if (mode === 'element') await page.mouse.move(panel!.x + 4, panel!.y + 200);
    else await page.mouse.move(panel!.x + 100, panel!.y + 150);
    await page.mouse.down();
    await page.mouse.up();
    const r = await hook(serviceWorker).wait(id);
    const scrollHeight = await page.evaluate(() => document.getElementById('panel')!.scrollHeight);
    expect(r.done.status, mode).toBe('complete');
    expect(r.done.docHeight, mode).toBe(scrollHeight);
    expect(r.frames.length, mode).toBeGreaterThan(3);
    await page.close();
  }
});

test('delayed capture waits before touching the page', async ({ context, serviceWorker }) => {
  const { page, url } = await open(context, 'article.html');
  const t0 = Date.now();
  const id = await hook(serviceWorker).start(url, 'full', { delayMs: 3000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => scrollY)).toBe(0); // the preload pass hasn't started
  const r = await hook(serviceWorker).wait(id);
  expect(r.done.status).toBe('complete');
  expect(Date.now() - t0).toBeGreaterThan(3000);
});

test('Esc in the selection picker cancels without capturing or opening the Studio', async ({
  context,
  serviceWorker,
}) => {
  const { page, url } = await open(context, 'article.html');
  const id = await hook(serviceWorker).start(url, 'selection');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const r = await hook(serviceWorker).wait(id);
  expect(r.done.status).toBe('cancelled');
  expect(r.frames).toEqual([]);
  await page.waitForTimeout(500);
  expect(context.pages().some((p) => p.url().includes('studio.html'))).toBe(false);
  // The page says so, then is untouched: no overlay or notice left on <html>.
  expect(
    await page.evaluate(
      () => (document.querySelector('[data-screenscroll]') as HTMLElement | null)?.dataset.message,
    ),
  ).toBe('Capture cancelled. Nothing was saved.');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lastElementChild?.tagName), {
      timeout: 10_000,
    })
    .toBe('BODY');
});

test('area: left and right edges resize, a box mark is drawn, Enter captures with it', async ({
  context,
  serviceWorker,
}) => {
  const { page, url } = await open(context, 'article.html');
  const id = await hook(serviceWorker).start(url, 'selection');
  await page.waitForTimeout(300);
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 5 });
  await page.mouse.up();
  // Right edge out by 100, left edge out by 50.
  for (const [from, to] of [
    [700, 800],
    [300, 250],
  ] as const) {
    await page.mouse.move(from, 350);
    await page.mouse.down();
    await page.mouse.move(to, 350, { steps: 4 });
    await page.mouse.up();
  }
  // Box tool (R), drawn inside the area.
  await page.keyboard.press('r');
  await page.mouse.move(350, 250);
  await page.mouse.down();
  await page.mouse.move(450, 320, { steps: 4 });
  await page.mouse.up();
  // Text (T): letters that are also tool keys go into the text; Enter commits it, then a
  // second Enter captures.
  await page.keyboard.press('t');
  await page.mouse.click(600, 450);
  await page.keyboard.type('Ram & Tea');
  await page.keyboard.press('Enter');
  const studioOpens = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
    timeout: 60_000,
  });
  await page.keyboard.press('Enter');
  const r = await hook(serviceWorker).wait(id);
  expect(r.done.status).toBe('complete');
  expect(r.done.docWidth).toBe(550);
  expect(r.done.docHeight).toBe(300);
  const studio = await studioOpens;
  await studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 60_000 },
  );
  const anns = await studio.evaluate(
    () =>
      (
        window as unknown as {
          __spStudio: { project(): { annotations: Array<Record<string, unknown>> } };
        }
      ).__spStudio.project().annotations,
  );
  expect(anns).toHaveLength(2);
  expect(anns[0]).toMatchObject({ kind: 'rect', x: 100, y: 50, w: 100, h: 70 });
  expect(anns[1]).toMatchObject({ kind: 'text', x: 350, y: 250, text: 'Ram & Tea' });
});

test('area: Ctrl+C copies the area and the page says so', async ({ context, serviceWorker }) => {
  const { page, url } = await open(context, 'article.html');
  const id = await hook(serviceWorker).start(url, 'selection');
  await page.waitForTimeout(300);
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  const r = await hook(serviceWorker).wait(id);
  expect(r.done.status).toBe('complete');
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (document.querySelector('[data-screenscroll]') as HTMLElement | null)?.dataset.message,
        ),
      { timeout: 30_000 },
    )
    .toBe('Copied as an image · 300 × 200 px');
  // The Studio tab that did the copying has closed itself.
  await expect
    .poll(() => context.pages().filter((p) => p.url().includes('studio.html')).length)
    .toBe(0);
});
