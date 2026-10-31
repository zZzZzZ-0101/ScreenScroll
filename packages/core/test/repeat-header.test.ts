import { describe, expect, it } from 'vitest';
import { emptyHints, type DomHints } from '../src/hints.js';
import { computeLayout, DEFAULT_PAGE_SETTINGS } from '../src/layout.js';
import { paginate, repeatHeight } from '../src/paginate.js';
import { contentLayout, locate } from '../src/pdf/locate.js';
import { ocrRuns } from '../src/ocr/runs.js';

/**
 * A heading line, then a table: a 30 px header row at y 50, then 60 rows of 24 px. Rows
 * are lines that must not be cut; breaks may fall between rows.
 */
function table(headerHeight = 30, withThead = true) {
  const h: DomHints = emptyHints();
  h.forbidden.push({ y0: 10, y1: 30, kind: 'line' });
  h.blockEnds.push({ y: 40, kind: 'paragraph' });
  const top = 50;
  let y = top + headerHeight;
  const rowEnds = [y];
  h.forbidden.push({ y0: top, y1: y, kind: 'line' });
  for (let r = 0; r < 60; r++) {
    h.forbidden.push({ y0: y + 2, y1: y + 22, kind: 'line' });
    y += 24;
    h.blockEnds.push({ y, kind: 'line' });
    rowEnds.push(y);
  }
  h.tables.push({
    y0: top,
    y1: y,
    rowEnds,
    headerHeight: withThead ? headerHeight : 0,
    ...(withThead ? { headerTop: top } : {}),
  });
  return { hints: h, height: y + 40, top, end: y };
}

const run = (t: ReturnType<typeof table>, T = 500, repeatHeaders = true) =>
  paginate({
    height: t.height,
    width: 600,
    T,
    hints: t.hints,
    options: { repeatHeaders },
  });

describe('table header repetition (PAGINATION §7)', () => {
  it('pages that start inside the table repeat its header; the header counts against T', () => {
    const t = table();
    const slices = run(t);
    expect(slices.length).toBeGreaterThan(2);
    expect(slices[0]!.repeat).toBeUndefined();
    for (const s of slices.slice(1)) {
      if (s.y0 > t.top + 30 && s.y0 < t.end) {
        expect(s.repeat).toEqual({ y0: 50, y1: 80 });
        // Header plus rows still fit one page.
        expect(s.y1 - s.y0 + repeatHeight(s)).toBeLessThanOrEqual(500);
      } else expect(s.repeat).toBeUndefined();
    }
  });
  it('none without a thead, when switched off, or when the header is over 25% of a page', () => {
    expect(run(table(30, false)).some((s) => s.repeat)).toBe(false);
    expect(run(table(), 500, false).some((s) => s.repeat)).toBe(false);
    expect(run(table(140)).some((s) => s.repeat)).toBe(false);
  });
  it('PDF content of such a page sits below the header: text, links and jumps', () => {
    const layout = computeLayout(DEFAULT_PAGE_SETTINGS, 600);
    const s = run(table()).find((x) => x.repeat)!;
    const moved = contentLayout(layout, s);
    expect(moved.box.y - layout.box.y).toBeCloseTo(30 * layout.s, 6);
    // A jump to the first row of that page lands just under the repeated header.
    const slices = run(table());
    const i = slices.indexOf(slices.find((x) => x.repeat)!);
    const dest = locate(slices, layout, slices[i]!.y0)!;
    expect(dest.page).toBe(i);
    expect(dest.top).toBeCloseTo(layout.paperH - layout.box.y - 30 * layout.s, 6);
  });
  it('OCR on such a page skips the header and maps the rest below it', () => {
    const slice = { x0: 0, y0: 1000, repeat: { y0: 50, y1: 80 } };
    const runs = ocrRuns(
      [
        { text: 'Name Qty', confidence: 0.99, box: { x: 10, y: 8, w: 100, h: 16 } },
        { text: 'Row 40', confidence: 0.99, box: { x: 10, y: 40, w: 80, h: 16 } },
      ],
      slice,
      1,
    );
    expect(runs.map((r) => [r.text, r.rect.y])).toEqual([['Row 40', 1010]]);
  });
});

describe('breaks that need a look', () => {
  const base = { x0: 0, x1: 100, overlapTop: 0, cost: 0, warnings: [] as string[] };
  it('flags forced, unconfirmed and pixel-only breaks, not clean ones or the end', async () => {
    const { breaksToCheck } = await import('../src/paginate.js');
    const got = breaksToCheck([
      { ...base, y0: 0, y1: 100, breakKind: 'paragraph' },
      { ...base, y0: 100, y1: 200, breakKind: 'pixel' },
      {
        ...base,
        y0: 200,
        y1: 300,
        breakKind: 'forced',
        warnings: ['Page 3: an element taller than one page was split.'],
      },
      {
        ...base,
        y0: 300,
        y1: 400,
        breakKind: 'line',
        warnings: ['Page 4: the break could not be confirmed against the image.'],
      },
      { ...base, y0: 400, y1: 500, breakKind: 'end' },
    ]);
    expect(got).toEqual([
      { index: 1, y: 200, reason: 'Found in the image only; no text line confirms it.' },
      { index: 2, y: 300, reason: 'An element taller than one page was split.' },
      { index: 3, y: 400, reason: 'The break could not be confirmed against the image.' },
    ]);
  });
});
