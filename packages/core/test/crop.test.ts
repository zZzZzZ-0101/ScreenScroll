import { describe, expect, it } from 'vitest';
import { contentCrop } from '../src/crop.js';
import { emptyHints } from '../src/hints.js';
import { analyzeRows } from '../src/rows.js';

function columnImage(width: number, x0: number, x1: number) {
  const data = new Uint8Array(width * 50).fill(255);
  for (let y = 10; y < 40; y += 4) for (let x = x0; x < x1; x++) data[y * width + x] = 0;
  return analyzeRows({ width, height: 50, data });
}

describe('contentCrop', () => {
  it('crops wide empty margins to the content column, padded', () => {
    const rows = columnImage(1920, 610, 1310);
    expect(contentCrop(1920, { rows })).toEqual({ x0: 598, x1: 1322, cropped: true });
  });

  it('scales analysis columns to CSS px', () => {
    const rows = columnImage(960, 305, 655); // analysis at half width
    const c = contentCrop(1920, { rows });
    expect(c.cropped).toBe(true);
    expect(c.x0).toBe(598);
    expect(c.x1).toBeCloseTo(1322, 0);
  });

  it('leaves narrow margins alone', () => {
    const rows = columnImage(1000, 60, 940);
    expect(contentCrop(1000, { rows })).toEqual({ x0: 0, x1: 1000, cropped: false });
  });

  it('uses DOM text when there are no pixels', () => {
    const hints = emptyHints();
    hints.textRuns.push({
      text: 'a',
      rect: { x: 500, y: 0, width: 700, height: 20 },
      fontSizePx: 16,
    });
    expect(contentCrop(1920, { hints })).toEqual({ x0: 488, x1: 1212, cropped: true });
  });

  it('a full-width top bar with a little ink at both edges does not stop the crop', () => {
    const width = 1920;
    const height = 2000;
    const data = new Uint8Array(width * height).fill(255);
    // Top bar: a logo at the far left, icons at the far right, rows 4–24.
    const bar: Array<[number, number]> = [
      [16, 60],
      [1800, 1900],
    ];
    for (let y = 4; y < 24; y++)
      for (const [a, b] of bar) for (let x = a; x < b; x++) data[y * width + x] = 0;
    // The page: a centred 700 px column of text lines.
    for (let y = 40; y < height; y += 4) for (let x = 610; x < 1310; x++) data[y * width + x] = 0;
    const c = contentCrop(width, { rows: analyzeRows({ width, height, data }) });
    expect(c).toEqual({ x0: 598, x1: 1322, cropped: true });
  });

  it('a sidebar with real content is kept', () => {
    const width = 1920;
    const data = new Uint8Array(width * 400).fill(255);
    for (let y = 40; y < 400; y += 4) for (let x = 610; x < 1310; x++) data[y * width + x] = 0;
    for (let y = 40; y < 300; y += 6) for (let x = 1400; x < 1600; x++) data[y * width + x] = 0;
    const c = contentCrop(width, { rows: analyzeRows({ width, height: 400, data }) });
    expect(c.x1).toBeGreaterThanOrEqual(1600);
  });

  it('does nothing for a blank page', () => {
    expect(contentCrop(800, {})).toEqual({ x0: 0, x1: 800, cropped: false });
  });
});
