import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  DEFAULT_PAGE_SETTINGS,
  medianFontPx,
  PT_PER_MM,
  readabilityAdvice,
  type PageSettings,
} from '../src/layout.js';

const noBands: PageSettings = { ...DEFAULT_PAGE_SETTINGS, footerPt: 0 };

describe('computeLayout', () => {
  it('A4 portrait, 10 mm margins, fit to 760 px content', () => {
    const l = computeLayout(noBands, 760);
    expect(l.paperW).toBeCloseTo(595.28, 1);
    expect(l.paperH).toBeCloseTo(841.89, 1);
    expect(l.box.w).toBeCloseTo(190 * PT_PER_MM, 6);
    expect(l.s).toBeCloseTo(l.box.w / 760, 9);
    // T keeps the printable box's aspect ratio in CSS px.
    expect(l.T).toBeCloseTo((760 * 277) / 190, 6);
  });

  it('landscape swaps the sides', () => {
    const l = computeLayout({ ...noBands, orientation: 'landscape' }, 1000);
    expect(l.paperW).toBeGreaterThan(l.paperH);
    expect(l.paperW).toBeCloseTo(841.89, 1);
  });

  it('reserves header and footer bands', () => {
    const a = computeLayout(noBands, 800);
    const b = computeLayout({ ...noBands, headerPt: 12, footerPt: 14 }, 800);
    expect(a.box.h - b.box.h).toBeCloseTo(26, 9);
    expect(b.box.y - a.box.y).toBeCloseTo(12, 9);
  });

  it('fixed 100% scale is 0.75 pt per CSS px and is clamped when too wide', () => {
    const l = computeLayout({ ...noBands, scale: 100 }, 600);
    expect(l.s).toBe(0.75);
    expect(l.scaleClamped).toBe(false);
    const wide = computeLayout({ ...noBands, scale: 100 }, 1920);
    expect(wide.s).toBeCloseTo(wide.box.w / 1920, 9);
    expect(wide.scaleClamped).toBe(true);
  });

  it('custom paper in mm', () => {
    const l = computeLayout(
      {
        ...noBands,
        paper: { w: 100, h: 200 },
        marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      100,
    );
    expect(l.paperW).toBeCloseTo(100 * PT_PER_MM, 9);
    expect(l.T).toBeCloseTo(200, 9);
  });

  it('rejects margins that leave no room', () => {
    expect(() =>
      computeLayout({ ...noBands, marginsMm: { top: 150, right: 10, bottom: 150, left: 10 } }, 800),
    ).toThrow(/no room/);
  });
});

describe('readability', () => {
  it('warns below 7 pt with suggestions', () => {
    // 1920 px wide page on A4: s ≈ 0.28, 16 px text ≈ 4.5 pt.
    const { s } = computeLayout(noBands, 1920);
    expect(readabilityAdvice(16, s)).toMatch(
      /Text will be small \(≈4\.\d pt\)\. Try: crop margins/,
    );
    expect(readabilityAdvice(16, computeLayout(noBands, 760).s)).toBeNull();
    expect(readabilityAdvice(null, s)).toBeNull();
  });

  it('median font size', () => {
    expect(medianFontPx([16, 12, 20])).toBe(16);
    expect(medianFontPx([10, 20])).toBe(15);
    expect(medianFontPx([])).toBeNull();
  });
});

describe('printed text size', () => {
  it('16 px text from a 1280 px page on A4 with 10 mm margins, and the two fixes', async () => {
    const { printedTextSize, DEFAULT_PAGE_SETTINGS, PT_PER_MM } = await import('../src/layout.js');
    const r = printedTextSize(16, DEFAULT_PAGE_SETTINGS, 1280);
    const portraitW = (210 - 20) * PT_PER_MM; // 538.6 pt
    const landscapeW = (297 - 20) * PT_PER_MM; // 785.2 pt
    expect(r.pt).toBeCloseTo((16 * portraitW) / 1280, 6); // 6.7 pt
    expect(r.turnedPt).toBeCloseTo((16 * landscapeW) / 1280, 6); // 9.8 pt
    expect(r.narrowPt).toBeCloseTo((16 * portraitW) / 1000, 6); // 8.6 pt
    expect(printedTextSize(16, DEFAULT_PAGE_SETTINGS, 900).narrowPt).toBeNull();
  });
});

describe('paper matched to a page shape', () => {
  it('A4, Letter, landscape, slides, and a custom size otherwise', async () => {
    const { matchPaper } = await import('../src/layout.js');
    expect(matchPaper(1075 / 760)).toMatchObject({ paper: 'A4', orientation: 'portrait' });
    expect(matchPaper(11 / 8.5)).toMatchObject({ paper: 'Letter', orientation: 'portrait' });
    expect(matchPaper(210 / 297)).toMatchObject({ paper: 'A4', orientation: 'landscape' });
    expect(matchPaper(9 / 16).name).toBe('16:9 slide');
    expect(matchPaper(1.2)).toEqual({
      paper: { w: 210, h: 252 },
      orientation: 'portrait',
      name: 'Custom 210 × 252 mm',
    });
  });
});
