import { createCanvas, ImageData as SkImageData } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildPdf,
  buildSingleLongPagePdf,
  chooseImageFormat,
  type PageImage,
} from '@screenscroll/core/pdf';
import {
  analyzeRows,
  computeLayout,
  DEFAULT_PAGE_SETTINGS,
  paginate,
  toGrey,
  type PageSlice,
} from '@screenscroll/core';
import { synthFixtures, type SynthDoc } from '../src/synth.js';

const OUT = new URL('../out/', import.meta.url);
let docs: Map<string, SynthDoc>;

beforeAll(async () => {
  docs = new Map((await synthFixtures()).map((d) => [d.name, d]));
  mkdirSync(OUT, { recursive: true });
}, 60_000);

/** Composes one page image per slice from the synthetic capture (stand-in for the Studio). */
async function pageImages(doc: SynthDoc, slices: PageSlice[]): Promise<PageImage[]> {
  const full = createCanvas(doc.width, doc.height);
  full.getContext('2d').putImageData(new SkImageData(doc.rgba, doc.width, doc.height), 0, 0);
  return Promise.all(
    slices.map(async (slice) => {
      const w = Math.round(slice.x1 - slice.x0);
      const h = Math.round(slice.y1 - slice.y0);
      const c = createCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.drawImage(full, slice.x0, slice.y0, w, h, 0, 0, w, h);
      const format = chooseImageFormat(ctx.getImageData(0, 0, w, h).data);
      const bytes = format === 'png' ? await c.encode('png') : await c.encode('jpeg', 90);
      return { bytes: new Uint8Array(bytes), format, slice };
    }),
  );
}

/** pdf.js needs its own font data to draw the standard 14 fonts (our Helvetica footer). */
const STANDARD_FONTS = new URL('../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  .pathname;

async function renderPdfPage(bytes: Uint8Array, pageNo: number, file: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: STANDARD_FONTS })
    .promise;
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  // pdf.js types expect a DOM canvas; in Node it uses @napi-rs/canvas, which this is.
  await page.render({ canvas: canvas as never, viewport: vp }).promise;
  writeFileSync(new URL(file, OUT), canvas.toBuffer('image/png'));
  return pdf.numPages;
}

describe('PDF assembly', () => {
  for (const name of ['latin-cjk', 'tall-photo']) {
    it(`${name}: one A4 page per slice, metadata, readable by pdf.js`, async () => {
      const doc = docs.get(name)!;
      const layout = computeLayout(DEFAULT_PAGE_SETTINGS, doc.width);
      const rows = analyzeRows(
        toGrey({ width: doc.width, height: doc.height, data: doc.rgba, channels: 4 }),
      );
      const slices = paginate({
        height: doc.height,
        width: doc.width,
        T: layout.T,
        rows,
        hints: doc.hints,
      });
      const images = await pageImages(doc, slices);
      if (name === 'tall-photo') expect(images.some((i) => i.format === 'jpeg')).toBe(true);
      const meta = {
        title: `Synthetic ${name} 测试`,
        url: 'https://www.example.org/x',
        capturedAt: new Date(Date.UTC(2026, 9, 26, 22, 41)),
      };
      const bytes = await buildPdf(images, images.length, layout, meta);
      writeFileSync(new URL(`${name}.pdf`, OUT), bytes);

      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(pdf.getPageCount()).toBe(slices.length);
      for (const p of pdf.getPages()) {
        expect(p.getWidth()).toBeCloseTo(595.28, 1);
        expect(p.getHeight()).toBeCloseTo(841.89, 1);
      }
      expect(pdf.getTitle()).toBe(meta.title);
      expect(pdf.getSubject()).toBe(meta.url);
      expect(pdf.getProducer()).toBe('ScreenScroll');

      expect(await renderPdfPage(bytes, 1, `${name}-pdf-p1.png`)).toBe(slices.length);
      await renderPdfPage(bytes, 2, `${name}-pdf-p2.png`);
    });
  }

  it('single long page: stacks slices on one page, refuses beyond 14,000 pt', async () => {
    const doc = docs.get('latin-cjk')!;
    const layout = computeLayout(DEFAULT_PAGE_SETTINGS, doc.width);
    const slices = paginate({
      height: doc.height,
      width: doc.width,
      T: layout.T,
      hints: doc.hints,
    });
    const images = await pageImages(doc, slices);
    const meta = { title: 'long', url: 'https://example.org/', capturedAt: new Date() };
    const bytes = await buildSingleLongPagePdf(images, doc.height, layout, meta);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(doc.height * layout.s + 2 * layout.box.x, 3);
    writeFileSync(new URL('latin-cjk-long.pdf', OUT), bytes);
    await renderPdfPage(bytes, 1, 'latin-cjk-long.png');
    await expect(buildSingleLongPagePdf(images, 30_000, layout, meta)).rejects.toThrow(/14,000 pt/);
  });
});
