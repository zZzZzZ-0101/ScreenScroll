import { createCanvas, ImageData as SkImageData } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildGlyphlessFont,
  buildPdf,
  chooseImageFormat,
  type PageImage,
} from '@scrollpress/core/pdf';
import { computeLayout, DEFAULT_PAGE_SETTINGS, paginate, type PageSlice } from '@scrollpress/core';
import { synthFixtures, type SynthDoc } from '../src/synth.js';

const OUT = new URL('../out/', import.meta.url);
const STANDARD_FONTS = new URL('../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
  .pathname;
let doc: SynthDoc;

beforeAll(async () => {
  doc = (await synthFixtures()).find((d) => d.name === 'latin-cjk')!;
  mkdirSync(OUT, { recursive: true });
}, 60_000);

async function pageImages(d: SynthDoc, slices: PageSlice[]): Promise<PageImage[]> {
  const full = createCanvas(d.width, d.height);
  full.getContext('2d').putImageData(new SkImageData(d.rgba, d.width, d.height), 0, 0);
  return Promise.all(
    slices.map(async (slice) => {
      const w = Math.round(slice.x1 - slice.x0);
      const h = Math.round(slice.y1 - slice.y0);
      const c = createCanvas(w, h);
      c.getContext('2d').drawImage(full, slice.x0, slice.y0, w, h, 0, 0, w, h);
      const format = chooseImageFormat(c.getContext('2d').getImageData(0, 0, w, h).data);
      return { bytes: new Uint8Array(await c.encode('png')), format: format && 'png', slice };
    }),
  );
}

describe('invisible text layer', () => {
  it('glyphless font is a valid TrueType file', () => {
    const font = buildGlyphlessFont();
    writeFileSync(new URL('glyphless.ttf', OUT), font);
    expect(new DataView(font.buffer).getUint32(0)).toBe(0x00010000);
  });

  it('makes English and Chinese text extractable, page by page, in reading order', async () => {
    const layout = computeLayout(DEFAULT_PAGE_SETTINGS, doc.width);
    const slices = paginate({
      height: doc.height,
      width: doc.width,
      T: layout.T,
      hints: doc.hints,
    });
    const images = await pageImages(doc, slices);
    const meta = {
      title: 'Text layer',
      url: 'https://example.org/',
      capturedAt: new Date(Date.UTC(2026, 9, 28)),
    };
    const bytes = await buildPdf(
      images,
      images.length,
      layout,
      meta,
      {},
      { textRuns: doc.hints.textRuns },
    );
    writeFileSync(new URL('textlayer.pdf', OUT), bytes);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      pageTexts.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    const all = pageTexts.join('\n');
    // Every line drawn by the generator is found, Latin and Chinese alike.
    const expected = doc.hints.textRuns.map((r) => r.text);
    const missing = expected.filter((t) => !all.includes(t));
    expect(missing).toEqual([]);
    expect(all).toMatch(/[一-鿿]{6}/);
    // Each line appears on exactly one page.
    for (const t of expected.slice(0, 40))
      expect(pageTexts.filter((p) => p.includes(t))).toHaveLength(1);
    // Selection boxes sit on the visible text: pdf.js reports each run at its rectangle.
    const p1 = await (await pdf.getPage(1)).getTextContent();
    const s = layout.s;
    let checked = 0;
    for (const item of p1.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const run = doc.hints.textRuns.find((r) => r.text.trim() === item.str.trim());
      if (!run) continue;
      const x = layout.box.x + (run.rect.x - slices[0]!.x0) * s;
      const top = layout.paperH - (layout.box.y + (run.rect.y - slices[0]!.y0) * s);
      expect(Math.abs(item.transform[4] - x)).toBeLessThan(0.5);
      expect(Math.abs(item.width - run.rect.width * s)).toBeLessThan(
        0.02 * run.rect.width * s + 0.5,
      );
      // Baseline 80% of the box down: highlight spans the box.
      expect(Math.abs(item.transform[5] - (top - 0.8 * run.rect.height * s))).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // The footer drawn after the layer must stay visible (rendering mode is graphics state).
    const ops = await (await pdf.getPage(1)).getOperatorList();
    const modes: number[] = [];
    let saved: number[] = [];
    let mode = 0;
    ops.fnArray.forEach((fn, i) => {
      if (fn === pdfjs.OPS.save) saved.push(mode);
      else if (fn === pdfjs.OPS.restore) mode = saved.pop() ?? 0;
      else if (fn === pdfjs.OPS.setTextRenderingMode) mode = ops.argsArray[i][0];
      else if (fn === pdfjs.OPS.showText) modes.push(mode);
    });
    saved = [];
    expect(modes.at(-1)).toBe(0); // last text shown (the footer) is filled, not invisible
    expect(modes.filter((m) => m === 3).length).toBeGreaterThan(20);
    // Headings come before their paragraphs on the first page.
    expect(pageTexts[0]!.indexOf('Section 1')).toBeLessThan(pageTexts[0]!.indexOf(expected[1]!));
  });
});
