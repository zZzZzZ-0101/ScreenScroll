import { createCanvas } from '@napi-rs/canvas';
import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Annotation } from '../../packages/core/src/annotations';
import type { PageLayout } from '../../packages/core/src/layout';
import type { PageSlice } from '../../packages/core/src/paginate';
import type { Region } from '../../packages/core/src/region';
import { expect, test, FIXTURES } from './fixtures';

const STANDARD_FONTS = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  .pathname;

interface StudioHook {
  slices(): PageSlice[];
  layout(): PageLayout;
  project(): { annotations: Annotation[]; crop: Region | null };
  size(): { width: number; height: number };
  pdfBase64(): Promise<string>;
}

const hook = <T>(studio: Page, f: (h: StudioHook) => T | Promise<T>) =>
  studio.evaluate(`(${f.toString()})(window.__spStudio)`) as Promise<T>;

const ready = (studio: Page) =>
  studio.waitForFunction(
    () => 'project' in ((window as unknown as { __spStudio?: object }).__spStudio ?? {}),
    null,
    { timeout: 60_000 },
  );

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Document rectangle of an element on the captured page (it is restored to the top). */
const docRect = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  }, selector);

/** Screen position of a document point in the Annotate view, scrolling it into view. */
async function screen(studio: Page, width: number, x: number, y: number) {
  await studio.getByTestId('annotate-view').evaluate(
    (el, yy) => {
      const body = el.querySelector('[data-testid="annotate-body"]') as HTMLElement;
      const z = body.getBoundingClientRect().width / yy.width;
      const top = yy.y * z;
      if (top < el.scrollTop + 40 || top > el.scrollTop + el.clientHeight - 140)
        el.scrollTop = Math.max(0, top - 200);
    },
    { y, width },
  );
  const b = (await studio.getByTestId('annotate-body').boundingBox())!;
  const z = b.width / width;
  return { x: b.x + x * z, y: b.y + y * z };
}

async function drag(studio: Page, width: number, from: [number, number], to: [number, number]) {
  const a = await screen(studio, width, ...from);
  await studio.mouse.move(a.x, a.y);
  await studio.mouse.down();
  const b = await screen(studio, width, ...to);
  // Re-read the start after any scroll; the view only scrolls when `to` is far away.
  await studio.mouse.move(b.x, b.y, { steps: 8 });
  await studio.mouse.up();
}

async function click(studio: Page, width: number, x: number, y: number) {
  const p = await screen(studio, width, x, y);
  await studio.mouse.click(p.x, p.y);
}

const pad = (r: Box, d: number): [[number, number], [number, number]] => [
  [r.x - d, r.y - d],
  [r.x + r.width + d, r.y + r.height + d],
];

test('Annotate: draw, undo/redo, select/move/delete, crop, persist, flatten and redact', async ({
  context,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(`${FIXTURES}/article.html`);
  await page.bringToFront();
  const studioPromise = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/studio.html'),
  });
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ active: true, url });
    await (
      globalThis as unknown as { __spTest: { capture(id: number): Promise<unknown> } }
    ).__spTest.capture(tab!.id!);
  }, `${FIXTURES}/article.html`);
  const studio = await studioPromise;
  await studio.setViewportSize({ width: 1400, height: 900 });
  await ready(studio);
  const { width } = await hook(studio, (h) => h.size());

  const s1 = await docRect(page, '#s1');
  const s2 = await docRect(page, '#s2');
  const intro = await docRect(page, 'main > p');
  const main = await docRect(page, 'main');
  const s5 = await docRect(page, '#s5');

  await studio.getByRole('tab', { name: 'Mark up' }).click();
  await expect(studio.getByTestId('annotate-view')).toBeVisible();
  await expect(studio.getByRole('toolbar', { name: 'Tools' })).toBeVisible();

  const anns = () => hook(studio, (h) => h.project().annotations);

  // Redactions over the first heading and the intro paragraph (which holds two links).
  await studio.keyboard.press('b');
  await drag(studio, width, ...pad(s1, 4));
  await studio.keyboard.press('x');
  await drag(studio, width, ...pad(intro, 4));
  // Shapes.
  await studio.keyboard.press('r');
  await drag(studio, width, ...pad(s2, 8));
  await studio.keyboard.press('a');
  await drag(studio, width, [s2.x + s2.width + 160, s2.y - 60], [s2.x + s2.width + 20, s2.y + 10]);
  await studio.keyboard.press('n');
  await click(studio, width, s2.x - 20, s2.y + s2.height / 2);
  await click(studio, width, s2.x - 20, s2.y + 120);
  await studio.keyboard.press('t');
  await click(studio, width, s2.x + s2.width + 30, s2.y + 60);
  await studio.keyboard.type('Check this');
  await studio.keyboard.press('Enter');

  let list = await anns();
  expect(list.map((a) => a.kind)).toEqual([
    'blur',
    'pixelate',
    'rect',
    'arrow',
    'step',
    'step',
    'text',
  ]);
  expect(list.filter((a) => a.kind === 'step').map((a) => (a as { n: number }).n)).toEqual([1, 2]);
  expect(list.at(-1)).toMatchObject({ kind: 'text', text: 'Check this' });

  // Undo / redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z).
  await studio.keyboard.press('Control+z');
  await studio.keyboard.press('Control+z');
  expect(await anns()).toHaveLength(5);
  await studio.keyboard.press('Control+y');
  await studio.keyboard.press('Control+Shift+z');
  expect(await anns()).toHaveLength(7);

  // Select the rectangle by its outline, delete it, bring it back.
  await studio.keyboard.press('v');
  await click(studio, width, s2.x + s2.width / 2, s2.y - 8);
  await expect(studio.getByTestId('selection')).toBeVisible();
  await studio.keyboard.press('Delete');
  expect((await anns()).map((a) => a.kind)).not.toContain('rect');
  await studio.keyboard.press('Control+z');
  expect((await anns()).map((a) => a.kind)).toContain('rect');

  // Move the second step marker 60 px right.
  const step2 = (await anns()).filter((a) => a.kind === 'step')[1] as { x: number; y: number };
  await drag(studio, width, [step2.x, step2.y], [step2.x + 60, step2.y]);
  const moved = (await anns()).filter((a) => a.kind === 'step')[1] as { x: number; y: number };
  expect(moved.x).toBeCloseTo(step2.x + 60, 0);
  expect(moved.y).toBeCloseTo(step2.y, 0);

  // Colour change applies to the selection.
  await studio.getByRole('radio', { name: '#1a73e8' }).click();
  expect(((await anns()).filter((a) => a.kind === 'step')[1] as Annotation).style.color).toBe(
    '#1a73e8',
  );

  mkdirSync('e2e-artifacts', { recursive: true });
  await screen(studio, width, 0, 0);
  await studio.screenshot({ path: 'e2e-artifacts/studio-annotate.png' });

  // Crop: paginate only the drawn region; the column's sides become the page width.
  const before = await hook(studio, (h) => h.slices().length);
  await studio.keyboard.press('c');
  await drag(studio, width, [main.x, s2.y - 10], [main.x + main.width, s5.y - 10]);
  const cropped = await hook(studio, (h) => h.slices());
  expect(cropped[0]!.y0).toBeCloseTo(s2.y - 10, 0);
  expect(cropped.at(-1)!.y1).toBeCloseTo(s5.y - 10, 0);
  expect(cropped[0]!.x0).toBeCloseTo(main.x, 0);
  expect(cropped[0]!.x1).toBeCloseTo(main.x + main.width, 0);
  expect(cropped.length).toBeLessThan(before);
  await expect(studio.getByTestId('crop-shade')).toBeVisible();
  await studio.screenshot({ path: 'e2e-artifacts/studio-annotate-crop.png' });
  await studio.getByRole('button', { name: 'Reset crop' }).click();
  expect(await hook(studio, (h) => h.slices()[0]!.y0)).toBe(0);

  // Pages view previews show the annotations too.
  await studio.getByRole('tab', { name: 'Pages' }).click();
  await studio.waitForTimeout(800);
  await studio.screenshot({ path: 'e2e-artifacts/studio-pages-annotated.png' });

  // Persisted: reopening the Studio brings the project back.
  list = await anns();
  await studio.waitForTimeout(600);
  await studio.reload();
  await ready(studio);
  expect(await anns()).toEqual(list);
  expect(await hook(studio, (h) => h.project().crop)).toBeNull();

  // Export: annotations flattened into the page images, redacted text and links gone.
  const slices = await hook(studio, (h) => h.slices());
  const layout = await hook(studio, (h) => h.layout());
  const bytes = new Uint8Array(Buffer.from(await hook(studio, (h) => h.pdfBase64()), 'base64'));
  const file = 'e2e-artifacts/article-annotated.pdf';
  writeFileSync(file, bytes);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: STANDARD_FONTS })
    .promise;
  let text = '';
  const uris: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    text += (await pg.getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join('');
    for (const a of await pg.getAnnotations()) if (a.url) uris.push(a.url as string);
  }
  expect(text).toContain('Section 2: Capture render');
  expect(text).not.toContain('Section 1: Scroll break');
  expect(text).not.toContain('A long article with headings');
  expect(uris).not.toContain('https://example.org/ref');
  const poppler = execFileSync('pdftotext', [file, '-']).toString();
  expect(poppler).toContain('Section 2');
  expect(poppler).not.toContain('Scroll break');
  const outline = await pdf.getOutline();
  expect(outline[0]!.items.map((o) => o.title)).not.toContain('Section 1: Scroll break');
  expect(outline[0]!.items).toHaveLength(7);

  // Render page 1 and look at the pixels.
  expect(slices[0]!.y0).toBe(0);
  const SCALE = 2;
  const p1 = await pdf.getPage(1);
  const vp = p1.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await p1.render({ canvas: canvas as never, viewport: vp }).promise;
  writeFileSync('e2e-artifacts/article-annotated-p1.png', canvas.toBuffer('image/png'));
  const ctx = canvas.getContext('2d');
  const toPx = (x: number, y: number) => ({
    x: Math.round((layout.box.x + (x - slices[0]!.x0) * layout.s) * SCALE),
    y: Math.round((layout.box.y + (y - slices[0]!.y0) * layout.s) * SCALE),
  });
  // The rectangle's top edge is red.
  const edge = toPx(s2.x + s2.width / 2, s2.y - 8);
  const [r, g, b] = ctx.getImageData(edge.x - 1, edge.y - 1, 3, 3).data;
  expect(r).toBeGreaterThan(170);
  expect(g).toBeLessThan(110);
  expect(b).toBeLessThan(110);
  const pixels = (area: Box) => {
    const a = toPx(area.x, area.y);
    const z = toPx(area.x + area.width, area.y + area.height);
    return { w: z.x - a.x, data: ctx.getImageData(a.x, a.y, z.x - a.x, z.y - a.y).data };
  };
  // No dark text pixels survive inside the blurred heading.
  const blurred = pixels(s1).data;
  let darkest = 255;
  for (let i = 0; i < blurred.length; i += 4)
    darkest = Math.min(darkest, (blurred[i]! + blurred[i + 1]! + blurred[i + 2]!) / 3);
  expect(darkest).toBeGreaterThan(90);
  // The pixelated paragraph is flat blocks: far fewer pixel-to-pixel changes than real text.
  const changes = ({ w, data }: { w: number; data: Uint8ClampedArray }) => {
    let n = 0;
    let total = 0;
    for (let i = 4; i < data.length; i += 4) {
      if ((i / 4) % w === 0) continue;
      total++;
      if (Math.abs(data[i]! - data[i - 4]!) > 24) n++;
    }
    return n / total;
  };
  const para = await docRect(page, 'main > p:nth-of-type(2)');
  expect(changes(pixels(intro))).toBeLessThan(changes(pixels(para)) / 2);
});
