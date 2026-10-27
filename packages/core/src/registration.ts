import type { GreyImage } from './image.js';

/** Per-row profile: mean grey of `bands` equal-width column bands. */
export function rowProfiles(img: GreyImage, bands = 32): Float32Array {
  const { width, height, data } = img;
  const out = new Float32Array(height * bands);
  for (let y = 0; y < height; y++) {
    for (let b = 0; b < bands; b++) {
      const x0 = Math.floor((b * width) / bands);
      const x1 = Math.max(x0 + 1, Math.floor(((b + 1) * width) / bands));
      let sum = 0;
      for (let x = x0; x < x1; x++) sum += data[y * width + x]!;
      out[y * bands + b] = sum / (x1 - x0);
    }
  }
  return out;
}

export interface Registration {
  /** Rows to move down from frame A to frame B: B's row r shows A's row r + shift. */
  shift: number;
  /** Normalised cross-correlation of the overlap at `shift`, in [-1, 1]. */
  score: number;
  /** False when the overlap is featureless or another shift matches almost as well. */
  confident: boolean;
}

/**
 * CAPTURE §9 seam safety net: when measured scroll offsets are unreliable, find the shift
 * between consecutive frames by normalised cross-correlation of row profiles.
 * Both images must have the same width; pass downscaled images to keep this cheap.
 */
export function registerFrames(
  a: GreyImage,
  b: GreyImage,
  opts: { bands?: number; minOverlap?: number } = {},
): Registration {
  const bands = opts.bands ?? 32;
  const minOverlap = opts.minOverlap ?? Math.max(8, Math.floor(Math.min(a.height, b.height) / 8));
  const pa = rowProfiles(a, bands);
  const pb = rowProfiles(b, bands);

  const scores: number[] = [];
  let best = { shift: 0, score: -Infinity };
  for (let shift = 0; shift <= a.height - minOverlap; shift++) {
    const rows = Math.min(a.height - shift, b.height);
    const s = ncc(pa.subarray(shift * bands, (shift + rows) * bands), pb.subarray(0, rows * bands));
    scores[shift] = s;
    if (s > best.score) best = { shift, score: s };
  }

  // Unique match: nothing outside ±2 rows of the best comes within 0.02 of it.
  let runnerUp = -Infinity;
  scores.forEach((s, shift) => {
    if (Math.abs(shift - best.shift) > 2) runnerUp = Math.max(runnerUp, s);
  });
  const confident =
    Number.isFinite(best.score) && best.score >= 0.9 && best.score - runnerUp >= 0.02;
  return { shift: best.shift, score: best.score, confident };
}

/** Pearson correlation; returns -Infinity for featureless input so it never wins. */
function ncc(x: Float32Array, y: Float32Array): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-6 || syy < 1e-6) return -Infinity;
  return sxy / Math.sqrt(sxx * syy);
}
