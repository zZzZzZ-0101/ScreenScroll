import { createCanvas, ImageData as SkImageData } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, type PageImage, type TextRenderer } from '@screenscroll/core/pdf';
import { computeLayout, DEFAULT_PAGE_SETTINGS, paginate, type PageSlice } from '@screenscroll/core';
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
      return { bytes: new Uint8Array(await c.encode('png')), format: 'png' as const, slice };
    }),
  );
}

/** Stand-in for the Studio's canvas renderer: system fonts, 4× resolution. */
const renderText: TextRenderer = async (text, sizePt) => {
  const scale = 4;
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = `${sizePt * scale}px "WenQuanYi Zen Hei", sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + 2;
  const h = Math.ceil(sizePt * scale * 1.25);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.font = probe.font;
  ctx.fillStyle = '#737373';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 1, h * 0.8);
  return { png: new Uint8Array(await c.encode('png')), widthPt: w / scale, heightPt: h / scale };
};

describe('links, outline, header and footer', () => {
  it('adds URI and in-document links, nested bookmarks and a Unicode header', async () => {
    const settings = { ...DEFAULT_PAGE_SETTINGS, headerPt: 14 };
    const layout = computeLayout(settings, doc.width);
    const slices = paginate({
      height: doc.height,
      width: doc.width,
      T: layout.T,
      hints: doc.hints,
    });
    const title = '分页截图 Synthetic 测试';
    const meta = {
      title,
      url: 'https://www.example.org/a',
      capturedAt: new Date(2026, 9, 28, 9, 5),
    };
    const bytes = await buildPdf(
      await pageImages(doc, slices),
      slices.length,
      layout,
      meta,
      { header: { left: '{title}', center: '', right: '{time}' }, renderText },
      { textRuns: doc.hints.textRuns, links: doc.hints.links, headings: doc.hints.headings },
    );
    writeFileSync(new URL('features.pdf', OUT), bytes);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;

    // Bookmarks: every heading, nested by level, each pointing at the page that shows it.
    const outline = await pdf.getOutline();
    const flat: Array<{ title: string; depth: number; page: number }> = [];
    const walk = async (items: typeof outline, depth: number) => {
      for (const it of items) {
        const dest = Array.isArray(it.dest) ? it.dest : await pdf.getDestination(it.dest as string);
        flat.push({ title: it.title, depth, page: await pdf.getPageIndex(dest![0]) });
        await walk(it.items, depth + 1);
      }
    };
    await walk(outline, 0);
    expect(flat.map((f) => f.title)).toEqual(doc.hints.headings.map((h) => h.text));
    expect(flat.find((f) => f.title.startsWith('Subsection'))!.depth).toBe(2);
    for (const h of doc.hints.headings) {
      const page = slices.findIndex((s) => h.y >= s.y0 + s.overlapTop && h.y < s.y1);
      expect(flat.find((f) => f.title === h.text)!.page).toBe(page);
    }

    // Links: external URLs and in-document jumps resolve to the right pages.
    const uris: string[] = [];
    const jumps: number[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      for (const a of await (await pdf.getPage(i)).getAnnotations()) {
        if (a.subtype !== 'Link') continue;
        if (a.url) uris.push(a.url);
        else if (a.dest) jumps.push(await pdf.getPageIndex((a.dest as unknown[])[0] as never));
      }
    }
    expect(uris).toContain('https://example.org/section-0');
    expect(uris.length).toBeGreaterThanOrEqual(doc.hints.headings.length);
    const expectedJumps = doc.hints.links
      .filter((l) => l.targetY !== undefined)
      .map((l) => slices.findIndex((s) => l.targetY! >= s.y0 + s.overlapTop && l.targetY! < s.y1));
    expect(jumps).toEqual(expectedJumps);

    // Header: the Chinese title is rendered visibly (image) and found by text search.
    const p1 = await (await pdf.getPage(1)).getTextContent();
    const text = p1.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    expect(text).toContain(title);
    expect(text).toContain('09:05');
    expect(
      execFileSync('pdftotext', [
        '-f',
        '1',
        '-l',
        '1',
        new URL('features.pdf', OUT).pathname,
        '-',
      ]).toString(),
    ).toContain(title);
    // The footer is plain Helvetica text.
    expect(text).toContain('example.org · 2026-10-28');
  });
});

describe('merged PDF', () => {
  it('numbers pages across parts and gives each part a bookmark with its headings', async () => {
    const { buildMergedPdf } = await import('@screenscroll/core/pdf');
    const settings = { ...DEFAULT_PAGE_SETTINGS, footerPt: 14 };
    const layout = computeLayout(settings, doc.width);
    const slices = paginate({
      height: doc.height,
      width: doc.width,
      T: layout.T,
      hints: doc.hints,
    });
    const part = (title: string) => ({
      pageCount: slices.length,
      layout,
      meta: { title, url: `https://example.org/${title}`, capturedAt: new Date(2026, 9, 28) },
      content: { textRuns: doc.hints.textRuns, headings: doc.hints.headings },
    });
    const bytes = await buildMergedPdf(
      [
        { ...part('First'), pages: await pageImages(doc, slices) },
        { ...part('Second'), pages: await pageImages(doc, slices) },
      ],
      { title: 'Merged', url: '', capturedAt: new Date(2026, 9, 28) },
      { footer: { left: '{title}', center: '', right: '{page}/{pages}' } },
    );
    writeFileSync(new URL('merged.pdf', OUT), bytes);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;
    const total = 2 * slices.length;
    expect(pdf.numPages).toBe(total);
    const text = async (i: number) =>
      (await (await pdf.getPage(i)).getTextContent()).items
        .map((it) => ('str' in it ? it.str : ''))
        .join('');
    expect(await text(1)).toContain(`1/${total}`);
    expect(await text(1)).toContain('First');
    expect(await text(total)).toContain(`${total}/${total}`);
    expect(await text(total)).toContain('Second');
    const outline = await pdf.getOutline();
    expect(outline.map((o) => o.title)).toEqual(['First', 'Second']);
    expect(outline[0]!.items.length).toBeGreaterThan(0);
    expect(outline[1]!.items.map((o) => o.title)).toEqual(outline[0]!.items.map((o) => o.title));
    const dest = outline[1]!.dest as unknown[];
    expect(await pdf.getPageIndex(dest[0] as never)).toBe(slices.length);
  });

  it('skips empty parts without breaking the outline', async () => {
    const { buildMergedPdf } = await import('@screenscroll/core/pdf');
    const layout = computeLayout(DEFAULT_PAGE_SETTINGS, doc.width);
    const slices = paginate({ height: doc.height, width: doc.width, T: layout.T });
    const meta = { title: 'A', url: '', capturedAt: new Date(2026, 9, 28) };
    const bytes = await buildMergedPdf(
      [
        { pages: [], pageCount: 0, layout, meta: { ...meta, title: 'Empty' } },
        { pages: (await pageImages(doc, slices)).slice(0, 1), pageCount: 1, layout, meta },
      ],
      meta,
    );
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;
    expect(pdf.numPages).toBe(1);
    expect((await pdf.getOutline())?.map((o) => o.title)).toEqual(['A']);
  });
});

describe('watermark', () => {
  it('draws on the chosen pages only, as faint rotated text', async () => {
    const { buildPdf } = await import('@screenscroll/core/pdf');
    const layout = computeLayout(DEFAULT_PAGE_SETTINGS, doc.width);
    const slices = paginate({ height: doc.height, width: doc.width, T: layout.T }).slice(0, 3);
    const meta = { title: 'W', url: '', capturedAt: new Date(2026, 9, 28) };
    const bytes = await buildPdf(await pageImages(doc, slices), slices.length, layout, meta, {
      watermark: {
        text: 'CONFIDENTIAL',
        opacity: 0.2,
        sizePt: 70,
        angle: 45,
        color: '#d93025',
        pages: '2-3',
      },
    });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONTS,
    }).promise;
    const texts: string[] = [];
    for (let i = 1; i <= 3; i++)
      texts.push(
        (await (await pdf.getPage(i)).getTextContent()).items
          .map((it) => ('str' in it ? it.str : ''))
          .join(''),
      );
    expect(texts[0]).not.toContain('CONFIDENTIAL');
    expect(texts[1]).toContain('CONFIDENTIAL');
    expect(texts[2]).toContain('CONFIDENTIAL');
    const p2 = await pdf.getPage(2);
    const vp = p2.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    await p2.render({ canvas: canvas as never, viewport: vp }).promise;
    writeFileSync(new URL('watermark-p2.png', OUT), canvas.toBuffer('image/png'));
  });
});
