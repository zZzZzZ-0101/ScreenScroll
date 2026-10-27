import { describe, expect, it } from 'vitest';
import { emptyHints, type DomHints } from '../src/hints.js';
import { paginate, sliderWeights, type PageSlice } from '../src/paginate.js';

/** Builds hints for a column of paragraphs: `paras[i]` lines each, 16 px boxes on a 20 px pitch. */
function article(paras: number[], opts: { paraGap?: number; heading?: number[] } = {}) {
  const h: DomHints = emptyHints();
  const lines: Array<[number, number]> = [];
  let y = 10;
  paras.forEach((n, p) => {
    if (opts.heading?.includes(p)) {
      h.blockEnds.push({ y: y - 4, kind: 'section' });
      h.forbidden.push({ y0: y - 1, y1: y + 29, kind: 'line' });
      lines.push([y, y + 28]);
      h.keepWithNext.push({ y0: y, y1: y + 40 + 16 });
      h.blockEnds.push({ y: y + 30, kind: 'paragraph' });
      y += 40;
    }
    for (let l = 0; l < n; l++) {
      h.forbidden.push({ y0: y - 1, y1: y + 17, kind: 'line' });
      lines.push([y, y + 16]);
      if (l < n - 1) h.blockEnds.push({ y: y + 18, kind: 'line' });
      y += 20;
    }
    h.blockEnds.push({ y: y - 2, kind: 'paragraph' });
    y += opts.paraGap ?? 12;
  });
  return { hints: h, height: y + 10, lines };
}

/** Invariants from TESTING §1 that hold for every input. */
function checkInvariants(
  slices: PageSlice[],
  H: number,
  T: number,
  lines: Array<[number, number]>,
) {
  expect(slices[0]!.y0).toBe(0);
  expect(slices.at(-1)!.y1).toBe(H);
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]!;
    expect(s.y1 - s.y0).toBeLessThanOrEqual(T + 1e-6); // incl. overlap
    if (i > 0) expect(s.y0 + s.overlapTop).toBeCloseTo(slices[i - 1]!.y1, 9); // tiles exactly
    const forcedCut = s.breakKind === 'forced';
    if (i < slices.length - 1 && !forcedCut) {
      for (const [a, b] of lines) expect(s.y1 <= a || s.y1 >= b).toBe(true);
    }
  }
}

describe('paginate', () => {
  it('returns one page when everything fits', () => {
    expect(paginate({ height: 500, width: 800, T: 600 })).toEqual([
      { y0: 0, y1: 500, x0: 0, x1: 800, overlapTop: 0, breakKind: 'end', cost: 0, warnings: [] },
    ]);
  });

  it('never cuts a text line and keeps every page within T', () => {
    const { hints, height, lines } = article([5, 3, 8, 2, 6, 7, 4, 9, 3, 5, 6]);
    for (const T of [180, 250, 333, 500]) {
      const slices = paginate({ height, width: 700, T, hints });
      checkInvariants(slices, height, T, lines);
      expect(slices.every((s) => s.warnings.length === 0)).toBe(true);
    }
  });

  it('prefers paragraph breaks to line breaks when the page can hold them', () => {
    const { hints, height } = article([4, 4, 4, 4, 4, 4, 4, 4]);
    const slices = paginate({ height, width: 700, T: 400, hints });
    for (const s of slices.slice(0, -1)) expect(s.breakKind).toBe('paragraph');
  });

  it('is deterministic', () => {
    const { hints, height } = article([5, 9, 2, 7, 7, 3, 8]);
    const a = paginate({ height, width: 700, T: 260, hints });
    const b = paginate({ height, width: 700, T: 260, hints: structuredClone(hints) });
    expect(a).toEqual(b);
  });

  it('keeps a heading with the following line when it can', () => {
    const { hints, height } = article([10, 6, 6], { heading: [1, 2] });
    const headingKwn = hints.keepWithNext;
    for (const T of [260, 300, 340]) {
      const slices = paginate({ height, width: 700, T, hints });
      for (const s of slices.slice(0, -1)) {
        expect(headingKwn.some((k) => s.y1 > k.y0 && s.y1 < k.y1)).toBe(false);
      }
    }
  });

  it('splits an element taller than a page with an overlap and a warning', () => {
    const h = emptyHints();
    h.forbidden.push({ y0: 100, y1: 1300, kind: 'atomic' }); // 3× T
    const T = 400;
    const slices = paginate({ height: 1400, width: 600, T, hints: h, options: { overlap: 30 } });
    checkInvariants(slices, 1400, T, []);
    const forced = slices.filter((s) => s.breakKind === 'forced');
    expect(forced.length).toBeGreaterThanOrEqual(2);
    for (const s of forced)
      expect(s.warnings[0]).toMatch(/^Page \d+: an element taller than one page was split\.$/);
    // The page after each forced cut repeats 30 px.
    slices.forEach((s, i) => {
      if (i > 0 && slices[i - 1]!.breakKind === 'forced') expect(s.overlapTop).toBe(30);
    });
    // Forced cuts only inside the tall element.
    for (const s of forced) expect(s.y1 > 100 && s.y1 < 1300).toBe(true);
  });

  it('honours pinned and removed breaks', () => {
    const { hints, height, lines } = article([4, 4, 4, 4, 4, 4, 4, 4]);
    const T = 400;
    const auto = paginate({ height, width: 700, T, hints });
    const first = auto[0]!.y1;
    const removed = paginate({ height, width: 700, T, hints, options: { removed: [first] } });
    expect(removed.some((s) => Math.abs(s.y1 - first) <= 3)).toBe(false);
    checkInvariants(removed, height, T, lines);

    const gapY = lines[6]![1] + 2; // in the gap just under line 7
    const pinned = paginate({ height, width: 700, T, hints, options: { pinned: [gapY] } });
    expect(pinned.some((s) => s.y1 === gapY && s.breakKind === 'manual')).toBe(true);
  });

  it('falls back to overlapping cuts with warnings when nothing is known', () => {
    const slices = paginate({ height: 2000, width: 800, T: 500 });
    checkInvariants(slices, 2000, 500, []);
    expect(slices.slice(0, -1).every((s) => s.warnings[0]?.includes('no clean break'))).toBe(true);
  });

  it('slider trades page count for break quality', () => {
    expect(sliderWeights(0.5)).toEqual({ alpha: 1, beta: 1 });
    const { hints, height } = article([3, 11, 2, 9, 4, 12, 3, 8, 5]);
    const packed = paginate({ height, width: 700, T: 300, hints, options: sliderWeights(0) });
    const clean = paginate({ height, width: 700, T: 300, hints, options: sliderWeights(1) });
    const lineBreaks = (ss: PageSlice[]) => ss.filter((s) => s.breakKind === 'line').length;
    expect(packed.length).toBeLessThanOrEqual(clean.length);
    expect(lineBreaks(clean)).toBeLessThanOrEqual(lineBreaks(packed));
  });
});
