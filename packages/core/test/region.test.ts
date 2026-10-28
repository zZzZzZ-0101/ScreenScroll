import { describe, expect, it } from 'vitest';
import { normalizeRegion, regionFrame, regionScroll, type Region } from '../src/region.js';

const viewport = { x: 0, y: 0, width: 1000, height: 800 };

/** Simulates a region capture on a page `docHeight` tall: returns the frames taken. */
function simulate(region: Region, docHeight: number) {
  const maxScroll = docHeight - viewport.height;
  const frames = [];
  let covered = region.y0;
  for (let guard = 0; covered < region.y1 && guard < 100; guard++) {
    const offset = regionScroll(covered, maxScroll);
    const f = regionFrame(region, viewport, offset, covered);
    if (!f) break;
    frames.push({ offset, ...f });
    covered = f.coveredTo;
  }
  return frames;
}

describe('region capture', () => {
  it('covers a selection taller than the viewport with abutting frames', () => {
    const frames = simulate({ x0: 100, x1: 700, y0: 300, y1: 2300 }, 5000);
    expect(frames.map((f) => f.docY)).toEqual([0, 800, 1600]);
    expect(frames.map((f) => f.crop.height)).toEqual([800, 800, 400]);
    expect(frames.every((f) => f.crop.x === 100 && f.crop.width === 600)).toBe(true);
    expect(frames.at(-1)!.coveredTo).toBe(2300);
  });

  it('crops lower in the view when scrolling is clamped at the bottom', () => {
    const frames = simulate({ x0: 0, x1: 1000, y0: 4500, y1: 4900 }, 5000);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.offset).toBe(4200);
    expect(frames[0]!.crop).toEqual({ x: 0, y: 300, width: 1000, height: 400 });
    expect(frames[0]!.docY).toBe(0);
  });

  it('takes a region inside the current view in one frame', () => {
    const f = regionFrame({ x0: 50, x1: 450, y0: 120, y1: 520 }, viewport, 0, 120)!;
    expect(f.crop).toEqual({ x: 50, y: 120, width: 400, height: 400 });
  });

  it('works inside an inner scroller whose box is offset in the viewport', () => {
    const panel = { x: 220, y: 56, width: 760, height: 700 };
    const f = regionFrame({ x0: 300, x1: 900, y0: 1000, y1: 1300 }, panel, 1000, 1000)!;
    expect(f.crop).toEqual({ x: 300, y: 56, width: 600, height: 300 });
  });

  it('returns null when a frame adds nothing', () => {
    expect(regionFrame({ x0: 0, x1: 100, y0: 0, y1: 100 }, viewport, 0, 100)).toBeNull();
  });

  it('normalizes a rectangle drawn in any direction and clamps it', () => {
    expect(normalizeRegion({ x: 500, y: 900 }, { x: -20, y: 100 }, 1000, 5000)).toEqual({
      x0: 0,
      x1: 500,
      y0: 100,
      y1: 900,
    });
  });
});
