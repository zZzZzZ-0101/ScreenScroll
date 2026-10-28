import { describe, expect, it } from 'vitest';
import { applyFilter, FILTERS, type Rgba } from '../src/filters.js';

/** A w×h image filled with `bg`, with `fg` drawn where `ink(x, y)` is true. */
function image(
  w: number,
  h: number,
  bg: [number, number, number],
  fg: [number, number, number],
  ink: (x: number, y: number) => boolean,
): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = ink(x, y) ? fg : bg;
      data.set([...c, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

const px = (img: Rgba, x: number, y: number) =>
  [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

/** Thin vertical strokes every 6 px, like a line of text. */
const strokes = (x: number, y: number) => y >= 20 && y < 32 && x % 6 < 2;

describe('filters', () => {
  it('every filter has a name, a one-line summary and details', () => {
    expect(FILTERS.map((f) => f.id)).toEqual([
      'original',
      'enhance',
      'sharpen',
      'grey',
      'bw',
      'inksaver',
    ]);
    for (const f of FILTERS) {
      expect(f.name && f.short && f.details && f.bestFor && f.notFor && f.params).toBeTruthy();
      expect(f.details).not.toMatch(/!/);
    }
  });

  it('original changes nothing', () => {
    const img = image(10, 10, [12, 200, 90], [0, 0, 0], () => false);
    const before = img.data.slice();
    applyFilter('original', img);
    expect(img.data).toEqual(before);
  });

  it('greyscale: equal channels, brightness kept', () => {
    const img = image(4, 4, [255, 0, 0], [0, 0, 0], () => false);
    applyFilter('grey', img);
    expect(px(img, 0, 0)).toEqual([54, 54, 54]);
  });

  it('black & white: faint grey text on an off-white page becomes black on white', () => {
    const img = image(60, 50, [240, 240, 236], [150, 150, 150], strokes);
    applyFilter('bw', img);
    expect(px(img, 0, 25)).toEqual([0, 0, 0]);
    expect(px(img, 3, 25)).toEqual([255, 255, 255]);
    expect(px(img, 30, 5)).toEqual([255, 255, 255]);
    expect(new Set(img.data.filter((_, i) => i % 4 !== 3))).toEqual(new Set([0, 255]));
  });

  it('black & white: white text on a dark panel becomes black text on white', () => {
    const img = image(60, 50, [30, 40, 70], [250, 250, 250], strokes);
    applyFilter('bw', img);
    expect(px(img, 0, 25)).toEqual([0, 0, 0]);
    expect(px(img, 3, 25)).toEqual([255, 255, 255]);
    expect(px(img, 30, 5)).toEqual([255, 255, 255]);
  });

  it('enhanced: an off-white background turns white, dark text stays dark', () => {
    const img = image(60, 50, [236, 236, 236], [60, 60, 60], strokes);
    applyFilter('enhance', img);
    expect(px(img, 30, 5)).toEqual([255, 255, 255]);
    expect(px(img, 0, 25)[0]).toBeLessThan(10);
  });

  it('ink saver: a dark-mode page becomes light with dark text; light pages stay', () => {
    const dark = image(80, 60, [20, 20, 30], [230, 230, 230], strokes);
    applyFilter('inksaver', dark);
    expect(px(dark, 40, 5)[0]).toBeGreaterThan(220);
    expect(px(dark, 0, 25)[0]).toBeLessThan(40);
    const light = image(80, 60, [250, 250, 250], [20, 20, 20], strokes);
    applyFilter('inksaver', light);
    expect(px(light, 40, 5)).toEqual([255, 255, 255]);
    expect(px(light, 0, 25)).toEqual([20, 20, 20]);
  });

  it('sharper text: edges gain contrast, flat areas do not change', () => {
    const img = image(20, 20, [200, 200, 200], [100, 100, 100], (x) => x >= 10);
    applyFilter('sharpen', img);
    expect(px(img, 2, 5)).toEqual([200, 200, 200]);
    expect(px(img, 9, 5)[0]).toBeGreaterThan(200);
    expect(px(img, 10, 5)[0]).toBeLessThan(100);
  });

  it('a full page at 2× stays fast enough to export', () => {
    const img = image(1600, 2263, [255, 255, 255], [0, 0, 0], (x, y) => y % 20 < 12 && x % 7 < 2);
    const t0 = performance.now();
    applyFilter('bw', img, 2);
    applyFilter('inksaver', img, 2);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
