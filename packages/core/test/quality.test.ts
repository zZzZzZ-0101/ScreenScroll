import { describe, expect, it } from 'vitest';
import { EXPORT_PRESETS, QUALITY, exportScale, imagePx, pageDpi } from '../src/quality.js';

describe('PDF quality presets', () => {
  it('dpi on paper: dpr · 72 / s', () => {
    // 800 CSS px across A4's 523 pt printable width: s ≈ 0.654.
    const s = 523 / 800;
    expect(pageDpi(1, s)).toBeCloseTo(110.1, 1);
    expect(pageDpi(2, s)).toBeCloseTo(220.3, 1);
    expect(pageDpi(3, s)).toBeCloseTo(330.4, 1);
  });

  it('caps scale images down, never up', () => {
    const s = 523 / 800;
    expect(exportScale(1, s, QUALITY.compact)).toBe(1); // 110 dpi is under 150
    expect(exportScale(2, s, QUALITY.compact)).toBeCloseTo(150 / 220.3, 3);
    expect(exportScale(3, s, QUALITY.balanced)).toBeCloseTo(300 / 330.4, 3);
    expect(exportScale(3, s, QUALITY.best)).toBe(1);
    expect(exportScale(3, s, QUALITY.lossless)).toBe(1);
  });

  it('presets run from smallest to exact', () => {
    const caps = EXPORT_PRESETS.map((p) => QUALITY[p].maxDpi ?? Infinity);
    expect(caps).toEqual([...caps].sort((a, b) => a - b));
    const q = EXPORT_PRESETS.map((p) => QUALITY[p].jpegQuality);
    expect(q).toEqual([...q].sort((a, b) => a - b));
    expect(QUALITY.lossless.format).toBe('png');
  });

  it('image size in px', () => {
    expect(imagePx(800, 1100, 2, 0.5)).toEqual({ w: 800, h: 1100 });
    expect(imagePx(0.1, 0.1, 1, 1)).toEqual({ w: 1, h: 1 });
  });
});
