import { describe, expect, it } from 'vitest';
import { intersect, mergeIntervals } from '../src/geometry.js';

describe('geometry', () => {
  it('intersects rects and clamps empty results to zero size', () => {
    expect(
      intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    });
    expect(
      intersect({ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: 5, width: 1, height: 1 }).width,
    ).toBe(0);
  });

  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { y0: 10, y1: 20 },
        { y0: 0, y1: 5 },
        { y0: 20, y1: 25 },
        { y0: 15, y1: 18 },
      ]),
    ).toEqual([
      { y0: 0, y1: 5 },
      { y0: 10, y1: 25 },
    ]);
  });
});
