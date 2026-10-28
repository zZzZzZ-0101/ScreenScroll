import { describe, expect, it } from 'vitest';
import { detectSheets, SheetAnalyzer } from '../src/sheets.js';
import type { GreyImage } from '../src/image.js';

interface Opts {
  width?: number;
  bg?: number;
  sheet?: [number, number];
  heights?: number[];
  gap?: number;
  top?: number;
  /** A dimmed file list showing beside the sheets on the right. */
  list?: boolean;
  /** A photo block inside sheet `photo`, of this grey. */
  photo?: [number, number];
}

/** A synthetic viewer: sheets of text on a background, like a PDF preview. */
function viewer(o: Opts = {}): GreyImage {
  const width = o.width ?? 800;
  const bg = o.bg ?? 50;
  const [sx0, sx1] = o.sheet ?? [150, 650];
  const heights = o.heights ?? [1000, 1000, 1000, 1000, 1000];
  const gap = o.gap ?? 16;
  const top = o.top ?? gap;
  const height = top + heights.reduce((a, h) => a + h + gap, 0);
  const data = new Uint8Array(width * height).fill(bg);
  if (o.list)
    for (let y = 0; y < height; y++)
      for (let x = 700; x < width; x++) data[y * width + x] = Math.floor(y / 40) % 2 ? 70 : 110;
  let y0 = top;
  heights.forEach((h, i) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = sx0; x < sx1; x++) data[y * width + x] = 255;
      // Text lines: dark dashes in rows 60..h-60, 20 px pitch.
      const ry = y - y0;
      if (ry > 60 && ry < h - 60 && ry % 20 < 9)
        for (let x = sx0 + 40; x < sx1 - 40; x++) if (x % 7 < 4) data[y * width + x] = 30;
      if (o.photo && o.photo[0] === i && ry > 300 && ry < 600)
        for (let x = sx0 + 20; x < sx1 - 20; x++) data[y * width + x] = o.photo[1];
    }
    y0 += h + gap;
  });
  return { width, height, data };
}

function profile(img: GreyImage) {
  const a = new SheetAnalyzer(img.width);
  // Feed in frame-sized chunks, as the Studio does.
  for (let y = 0; y < img.height; y += 700) {
    const h = Math.min(700, img.height - y);
    a.push({
      width: img.width,
      height: h,
      data: img.data.subarray(y * img.width, (y + h) * img.width),
    });
  }
  return a.finish();
}

describe('document sheets', () => {
  it('finds each page of a dark viewer, with a dimmed file list beside it', () => {
    const r = detectSheets(profile(viewer({ list: true })));
    expect(r).not.toBeNull();
    expect(r!.x0).toBeCloseTo(150, -1);
    expect(r!.x1).toBeCloseTo(650, -1);
    expect(r!.sheets).toHaveLength(5);
    expect(r!.sheets[0]).toEqual({ y0: 16, y1: 1016 });
    expect(r!.sheets[1]).toEqual({ y0: 1032, y1: 2032 });
  });

  it('works on a light grey viewer (Docs, Office) too', () => {
    const r = detectSheets(profile(viewer({ bg: 241 })));
    expect(r?.sheets).toHaveLength(5);
  });

  it('keeps a page whole when it holds a photo or a dark table', () => {
    const r = detectSheets(profile(viewer({ photo: [2, 120] })));
    expect(r?.sheets).toHaveLength(5);
    expect(r!.sheets[2]!.y1 - r!.sheets[2]!.y0).toBe(1000);
  });

  it('accepts a first and last page cut by the capture', () => {
    const r = detectSheets(profile(viewer({ top: 0, heights: [400, 1000, 1000, 300] })));
    expect(r?.sheets.map((s) => s.y1 - s.y0)).toEqual([400, 1000, 1000, 300]);
  });

  it('leaves ordinary pages alone', () => {
    // An article: white everywhere, text in a column, no gaps.
    const article = viewer({ bg: 255, gap: 0, heights: [3000] });
    expect(detectSheets(profile(article))).toBeNull();
    // A white column on a grey page, but continuous: one "sheet" is not a document.
    expect(detectSheets(profile(viewer({ gap: 0, heights: [4000] })))).toBeNull();
    // Cards of very different heights (a feed), not pages.
    expect(detectSheets(profile(viewer({ heights: [300, 900, 200, 1200, 400] })))).toBeNull();
    // White reaching both edges: no background to compare with.
    expect(detectSheets(profile(viewer({ sheet: [0, 800] })))).toBeNull();
  });

  it('one page per sheet, fitted and centred on the paper', async () => {
    const { computeLayout, DEFAULT_PAGE_SETTINGS } = await import('../src/layout.js');
    const { fitSheets, sheetSlices } = await import('../src/sheets.js');
    const l = {
      x0: 100,
      x1: 600,
      sheets: [
        { y0: 0, y1: 700 },
        { y0: 716, y1: 1416 },
      ],
    };
    const slices = sheetSlices(l);
    expect(slices.map((x) => [x.y0, x.y1, x.x0, x.x1, x.overlapTop])).toEqual([
      [0, 700, 100, 600, 0],
      [716, 1416, 100, 600, 0],
    ]);
    // A landscape-shaped sheet (500 × 700 is portrait; make it wide) on portrait A4.
    const wide = {
      x0: 0,
      x1: 1000,
      sheets: [
        { y0: 0, y1: 700 },
        { y0: 720, y1: 1420 },
      ],
    };
    const base = computeLayout(DEFAULT_PAGE_SETTINGS, 1000);
    const fitted = fitSheets(base, wide);
    expect(700 * fitted.s).toBeLessThanOrEqual(fitted.box.h + 1e-6);
    // A tall sheet: scaled to fit the height, centred horizontally.
    const tall = {
      x0: 0,
      x1: 500,
      sheets: [
        { y0: 0, y1: 1200 },
        { y0: 1216, y1: 2416 },
      ],
    };
    const t = fitSheets(computeLayout(DEFAULT_PAGE_SETTINGS, 500), tall);
    expect(1200 * t.s).toBeCloseTo(t.box.h, 3);
    const base2 = computeLayout(DEFAULT_PAGE_SETTINGS, 500);
    expect(t.box.x - base2.box.x).toBeCloseTo((base2.box.w - t.box.w) / 2, 3);
  });
});
