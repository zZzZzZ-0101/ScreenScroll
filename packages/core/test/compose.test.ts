import { describe, expect, it } from 'vitest';
import { composeOps, ownedBands, type FrameGeom } from '../src/compose.js';

const frame = (docY: number, height = 800, dpr = 1, cropY = 0): FrameGeom => ({
  docY,
  height,
  cropX: 0,
  cropY,
  dpr,
});

describe('ownedBands', () => {
  it('gives the clamped last frame only its new rows', () => {
    expect(ownedBands([frame(0), frame(800), frame(1200)])).toEqual([
      { y0: 0, y1: 800 },
      { y0: 800, y1: 1600 },
      { y0: 1600, y1: 2000 },
    ]);
  });
});

describe('composeOps', () => {
  const frames = [frame(0), frame(800), frame(1200)];

  it('tiles a slice that spans a frame seam without gaps or overlap', () => {
    const ops = composeOps(frames, { x0: 0, x1: 100, y0: 700, y1: 1700 }, 1);
    expect(ops.map((o) => [o.frame, o.sy, o.sh, o.dy])).toEqual([
      [0, 700, 100, 0],
      [1, 0, 800, 100],
      [2, 400, 100, 900],
    ]);
    const covered = ops.reduce((n, o) => n + o.dh, 0);
    expect(covered).toBe(1000);
  });

  it('scales source rects by frame DPR and honours the crop origin', () => {
    const hi = [{ docY: 0, height: 800, cropX: 30, cropY: 60, dpr: 1.25 }];
    const [op] = composeOps(hi, { x0: 40, x1: 140, y0: 100, y1: 200 }, 1.25);
    expect(op).toEqual({
      frame: 0,
      sx: 80,
      sy: 185,
      sw: 125,
      sh: 125,
      dx: 0,
      dy: 0,
      dw: 125,
      dh: 125,
    });
  });

  it('touches only frames that intersect the slice', () => {
    expect(composeOps(frames, { x0: 0, x1: 10, y0: 0, y1: 500 }, 1).map((o) => o.frame)).toEqual([
      0,
    ]);
  });
});
