import { describe, expect, it } from 'vitest';
import { detectSheets, gridOf, gridSheets, SheetAnalyzer } from '../src/sheets.js';
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
  /** A list of text lines from this x on; left of the sheets' right edge it shows through the gaps. */
  listFrom?: number;
  /** A photo block inside sheet `photo`, of this grey. */
  photo?: [number, number];
  /** Grey of the paper (255 = white; scans are off-white). */
  paper?: number;
  /** ± noise on the paper, like a scan. */
  noise?: number;
  /** A band across the whole page width (margins included) in sheet [i], rows [a, b), of grey g. */
  band?: [number, number, number, number];
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
      for (let x = o.listFrom ?? 700; x < width; x++)
        if (o.listFrom === undefined) data[y * width + x] = Math.floor(y / 40) % 2 ? 70 : 110;
        // Dimmed list rows: background with a line of grey text every 40 px.
        else if (y % 40 < 10 && x % 5 < 3) data[y * width + x] = 110;
  let y0 = top;
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  heights.forEach((h, i) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = sx0; x < sx1; x++)
        data[y * width + x] = (o.paper ?? 255) - Math.round(rand() * (o.noise ?? 0));
      // Text lines: dark dashes in rows 60..h-60, 20 px pitch.
      const ry = y - y0;
      if (ry > 60 && ry < h - 60 && ry % 20 < 9)
        for (let x = sx0 + 40; x < sx1 - 40; x++) if (x % 7 < 4) data[y * width + x] = 30;
      if (o.photo && o.photo[0] === i && ry > 300 && ry < 600)
        for (let x = sx0 + 20; x < sx1 - 20; x++) data[y * width + x] = o.photo[1];
      if (o.band && o.band[0] === i && ry >= o.band[1] && ry < o.band[2])
        for (let x = sx0; x < sx1; x++) data[y * width + x] = o.band[3];
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

  it('off-white, noisy pages (scans) are pages too, at their full width', () => {
    const r = detectSheets(profile(viewer({ paper: 238, noise: 8 })));
    expect(r?.sheets.map((s) => s.y1 - s.y0)).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(r!.x0).toBeCloseTo(150, -1);
    expect(r!.x1).toBeCloseTo(650, -1);
  });

  it('a band as dark as the background across a whole page does not split it', () => {
    // A full-bleed dark figure (or a slide's dark title bar) that looks exactly like a gap.
    for (const [a, b] of [
      [300, 500],
      [0, 120],
      [880, 1000],
    ] as const) {
      const r = detectSheets(profile(viewer({ band: [2, a, b, 50] })));
      expect(
        r?.sheets.map((s) => s.y1 - s.y0),
        `band ${a}-${b}`,
      ).toEqual([1000, 1000, 1000, 1000, 1000]);
    }
  });

  it('a very light viewer (248) around white pages', () => {
    const r = detectSheets(profile(viewer({ bg: 248, gap: 10 })));
    expect(r?.sheets.map((s) => s.y1 - s.y0)).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it('dark slides on a light viewer', () => {
    const r = detectSheets(
      profile(viewer({ bg: 241, paper: 40, heights: [560, 560, 560, 560], gap: 24 })),
    );
    expect(r?.sheets.map((s) => s.y1 - s.y0)).toEqual([560, 560, 560, 560]);
    expect(r!.x0).toBeCloseTo(150, -1);
  });

  it('a dimmed file list showing through the gaps does not move the edges', () => {
    // The list starts at x 500, inside the sheet columns (150–650): 30% of each gap row.
    const r = detectSheets(profile(viewer({ list: true, listFrom: 500, gap: 18 })));
    expect(r).not.toBeNull();
    expect(r!.sheets).toHaveLength(5);
    r!.sheets.forEach((s, i) => {
      expect(Math.abs(s.y0 - (18 + i * 1018))).toBeLessThanOrEqual(1);
      expect(Math.abs(s.y1 - (18 + i * 1018 + 1000))).toBeLessThanOrEqual(1);
    });
  });

  it('a white page of evenly sized text blocks is not a viewer', () => {
    // Paper = background: sections of an article, however regular, are not sheets.
    expect(detectSheets(profile(viewer({ bg: 255 })))).toBeNull();
    expect(
      detectSheets(profile(viewer({ bg: 255, gap: 40, list: true, listFrom: 500 }))),
    ).toBeNull();
  });

  it('pages set by hand: a grid down to the end, without a trailing sliver', () => {
    const g = { x0: 150, x1: 650, top: 16, height: 1000, gap: 16 };
    const r = gridSheets(g, 3100)!;
    expect(r.sheets).toEqual([
      { y0: 16, y1: 1016 },
      { y0: 1032, y1: 2032 },
      { y0: 2048, y1: 3048 },
    ]);
    // 3064–3100 is 36 px of a 1000 px page: left out. 3300 makes a 236 px last page: kept.
    expect(gridSheets(g, 3300)!.sheets.at(-1)).toEqual({ y0: 3064, y1: 3300 });
    expect(gridSheets({ ...g, height: 10 }, 3100)).toBeNull();
    expect(gridSheets({ ...g, x1: 160 }, 3100)).toBeNull();
    expect(gridSheets({ ...g, top: 4000 }, 3100)).toBeNull();
    // Detected → grid → the same pages.
    const found = detectSheets(profile(viewer()))!;
    const again = gridSheets(gridOf(found), viewer().height)!;
    expect(again.sheets).toEqual(found.sheets);
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

describe('ranked readings of a viewer (several interpretations)', () => {
  it('an ordinary viewer: the gaps reading wins clearly', async () => {
    const { sheetCandidates, sheetEvidence } = await import('../src/sheets.js');
    const p = profile(viewer());
    const c = sheetCandidates(sheetEvidence(p), detectSheets(p));
    expect(c[0]!.id).toBe('gaps');
    expect(c[0]!.probability).toBeGreaterThan(0.9);
    expect(c.reduce((a, x) => a + x.probability, 0)).toBeCloseTo(1, 6);
  });
  it('pages a 1 px line apart defeat the gaps; the A4 reading finds them', async () => {
    const { sheetCandidates, sheetEvidence } = await import('../src/sheets.js');
    // A4 pages 500 px wide (707 tall) with a single background row between them.
    const p = profile(viewer({ heights: [707, 707, 707, 707], gap: 1, top: 1 }));
    expect(detectSheets(p)).toBeNull();
    const c = sheetCandidates(sheetEvidence(p), null);
    expect(c[0]!.id).toBe('a4');
    expect(c[0]!.probability).toBeGreaterThan(0.6);
    const pages = c[0]!.layout.sheets;
    expect(pages.length).toBe(4);
    pages.forEach((s, i) => expect(Math.abs(s.y0 - (1 + i * 708))).toBeLessThanOrEqual(2));
  });
  it('an ordinary page has no readings at all', async () => {
    const { sheetCandidates, sheetEvidence } = await import('../src/sheets.js');
    expect(sheetCandidates(sheetEvidence(profile(viewer({ bg: 255 }))), null)).toEqual([]);
  });
});

describe('page detection diagnostics', () => {
  it('fit parts multiply to the fit, and the evidence summary is run lengths of gap rows', async () => {
    const { evidenceSummary, layoutFitParts, sheetEvidence } = await import('../src/sheets.js');
    const img = viewer({ heights: [1000, 1000, 1000], gap: 16 });
    const p = profile(img);
    const ev = sheetEvidence(p)!;
    const parts = layoutFitParts(ev, detectSheets(p)!);
    expect(parts.fit).toBeCloseTo(
      parts.gapFit * parts.pageFit * Math.exp(-parts.unexplained / 3),
      9,
    );
    expect(parts.gapFit).toBeGreaterThan(0.95);
    const sum = evidenceSummary(ev);
    expect(sum.gapRuns.reduce((a, b) => a + b, 0)).toBe(ev.height);
    // Gap first (row 0 is background), then page, gap, …: 16, 1000, 16, 1000, 16, 1000, 16.
    expect(sum.gapRuns[0]).toBe(0);
    expect(sum.gapRuns.slice(1)).toEqual([16, 1000, 16, 1000, 16, 1000, 16]);
  });
});
