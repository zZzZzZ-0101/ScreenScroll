import { describe, expect, it } from 'vitest';
import { greedyCuts, inkColumns, rowInk, toGrey, type GreyImage } from '../src/index.js';

/** White image with black text-like bands at the given row ranges and columns. */
function bands(
  width: number,
  height: number,
  rows: [number, number][],
  x0 = 10,
  x1 = width - 10,
): GreyImage {
  const data = new Uint8Array(width * height).fill(255);
  for (const [a, b] of rows)
    for (let y = a; y < b; y++) data.fill(0, y * width + x0, y * width + x1);
  return { width, height, data };
}

describe('toGrey', () => {
  it('converts RGBA to luma', () => {
    const rgba = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect(Array.from(toGrey({ width: 3, height: 1, data: rgba, channels: 4 }).data)).toEqual([
      255, 0, 76,
    ]);
  });
});

describe('rowInk', () => {
  it('counts dark pixels per row', () => {
    const img = bands(40, 4, [[1, 2]]);
    const ink = rowInk(img, 200, 1);
    expect(Array.from(ink)).toEqual([0, 20, 0, 0]);
  });
});

describe('inkColumns', () => {
  it('finds padded content bounds', () => {
    const img = bands(100, 10, [[2, 4]], 30, 60);
    expect(inkColumns(img, 5, 200, 1)).toEqual({ x0: 25, x1: 65 });
  });
  it('returns null for a blank image', () => {
    expect(inkColumns(bands(10, 10, []), 2)).toBeNull();
  });
});

describe('greedyCuts', () => {
  it('cuts only in blank rows between text lines', () => {
    // 10-row lines with 6-row gaps, 1000 rows tall.
    const lines: [number, number][] = [];
    for (let y = 4; y + 10 < 1000; y += 16) lines.push([y, y + 10]);
    const img = bands(50, 1000, lines);
    const ink = rowInk(img);
    const cuts = greedyCuts(ink, 300);
    expect(cuts[0]).toBe(0);
    expect(cuts.at(-1)).toBe(1000);
    for (const c of cuts.slice(1, -1)) expect(ink[c]).toBe(0);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeLessThanOrEqual(300);
  });
  it('returns a single page when the image fits', () => {
    expect(greedyCuts(new Uint32Array(100), 300)).toEqual([0, 100]);
  });
});
