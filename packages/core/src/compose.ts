import type { Px } from './geometry.js';

/** A stored frame: where its crop rect sits in the document and how big it is. */
export interface FrameGeom {
  /** Measured scroll offset of the crop top, region-relative CSS px. */
  docY: Px;
  /** Crop height in CSS px. */
  height: Px;
  /** Crop rect origin inside the frame image, device px. */
  cropX: number;
  cropY: number;
  /** Device px per CSS px observed for this frame. */
  dpr: number;
}

/** One `drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh)` call in device px. */
export interface DrawOp {
  frame: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Document band each frame is responsible for: only rows no earlier frame covered
 * (CAPTURE §9). The clamped last frame overlaps its predecessor and contributes just
 * its new rows, so nothing is drawn twice.
 */
export function ownedBands(frames: readonly FrameGeom[]): Array<{ y0: Px; y1: Px }> {
  let coveredTo = Number.NEGATIVE_INFINITY;
  return frames.map((f) => {
    const y0 = Math.max(f.docY, coveredTo);
    const y1 = Math.max(y0, f.docY + f.height);
    coveredTo = Math.max(coveredTo, y1);
    return { y0, y1 };
  });
}

/**
 * Draw operations that paint document rows [y0, y1) and columns [x0, x1) (CSS px) onto a
 * page canvas whose origin is (x0, y0) at `outDpr` device px per CSS px. Only frames that
 * intersect the slice are touched, so composing never needs more than one page of pixels.
 */
export function composeOps(
  frames: readonly FrameGeom[],
  slice: { x0: Px; x1: Px; y0: Px; y1: Px },
  outDpr: number,
): DrawOp[] {
  const ops: DrawOp[] = [];
  const bands = ownedBands(frames);
  frames.forEach((f, i) => {
    const band = bands[i]!;
    const a = Math.max(band.y0, slice.y0);
    const b = Math.min(band.y1, slice.y1);
    if (b <= a) return;
    ops.push({
      frame: i,
      sx: f.cropX + slice.x0 * f.dpr,
      sy: f.cropY + (a - f.docY) * f.dpr,
      sw: (slice.x1 - slice.x0) * f.dpr,
      sh: (b - a) * f.dpr,
      dx: 0,
      dy: (a - slice.y0) * outDpr,
      dw: (slice.x1 - slice.x0) * outDpr,
      dh: (b - a) * outDpr,
    });
  });
  return ops;
}
