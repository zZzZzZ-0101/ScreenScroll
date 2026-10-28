import { describe, expect, it } from 'vitest';
import { hexToRgb, NO_WATERMARK, parsePageList, watermarkOn } from '../src/watermark.js';

describe('watermark', () => {
  it('parses page lists forgivingly', () => {
    expect(parsePageList('1-3, 5', 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageList('8-', 10)).toEqual([8, 9, 10]);
    expect(parsePageList('-2', 10)).toEqual([1, 2]);
    expect(parsePageList('3，1；12, x, 0', 10)).toEqual([1, 3]);
    expect(parsePageList('5-3', 10)).toEqual([3, 4, 5]);
    expect(parsePageList('', 10)).toEqual([]);
  });

  it('applies to every page, the first, or chosen pages; never when empty', () => {
    const w = { ...NO_WATERMARK, text: 'DRAFT' };
    expect([1, 2, 3].map((n) => watermarkOn(w, n, 3))).toEqual([true, true, true]);
    expect([1, 2].map((n) => watermarkOn({ ...w, pages: 'first' }, n, 2))).toEqual([true, false]);
    expect([1, 2, 3].map((n) => watermarkOn({ ...w, pages: '2-' }, n, 3))).toEqual([
      false,
      true,
      true,
    ]);
    expect(watermarkOn({ ...w, text: '  ' }, 1, 1)).toBe(false);
  });

  it('reads colours', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('nope')).toEqual([0.5, 0.5, 0.5]);
  });
});
