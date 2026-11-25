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

/** Max rows at the bottom of frame A and top of frame B inspected for seam matching. */
export const SEAM_WINDOW = 200;
/** Shortest overlap (CSS px) trusted for pixel-only seam alignment. */
export const SEAM_MIN_OVERLAP = 16;

export type SeamCheck =
  | { kind: 'ok'; overlap: number; delta: 0; score: number }
  | { kind: 'adjusted'; overlap: number; delta: number; score: number }
  | { kind: 'unverified'; overlap: number; delta: 0; score: number };

/**
 * Compares the bottom strip of frame `i - 1` (`prevTail`) against the top strip of frame `i`
 * (`currHead`) when DOM seam anchors are unavailable or when frames nominally overlap.
 *
 * Requires both high profile correlation (`score >= 0.985`, unique peak) and near-identical
 * pixel intensities (`MAD <= 4` grey levels) before shifting a frame, so two different
 * paragraphs with similar line spacing never false-match.
 */
export function checkSeam(prevTail: GreyImage, currHead: GreyImage, nominalOverlap = 0): SeamCheck {
  if (
    prevTail.width !== currHead.width ||
    prevTail.width <= 0 ||
    prevTail.height < SEAM_MIN_OVERLAP ||
    currHead.height < SEAM_MIN_OVERLAP
  ) {
    return { kind: 'ok', overlap: nominalOverlap, delta: 0, score: -Infinity };
  }
  const reg = registerFrames(prevTail, currHead, { minOverlap: SEAM_MIN_OVERLAP });
  const overlap = Math.min(prevTail.height - reg.shift, currHead.height);
  if (reg.confident && reg.score >= 0.985 && overlap >= SEAM_MIN_OVERLAP) {
    const w = prevTail.width;
    const a = prevTail.data.subarray(reg.shift * w, (reg.shift + overlap) * w);
    const b = currHead.data.subarray(0, overlap * w);
    if (meanAbsDiff(a, b) <= 4 && greyStdDev(a) >= 4) {
      const delta = overlap - nominalOverlap;
      if (Math.abs(delta) >= 2) return { kind: 'adjusted', overlap, delta, score: reg.score };
      return { kind: 'ok', overlap: nominalOverlap, delta: 0, score: reg.score };
    }
  }
  // When frames were supposed to overlap significantly (e.g. clamped last screen) and both
  // regions have clear visual texture, a failed match means the page redrew between grabs.
  const nom = Math.round(nominalOverlap);
  if (nom >= 24 && nom <= Math.min(prevTail.height, currHead.height)) {
    const w = prevTail.width;
    const a = prevTail.data.subarray((prevTail.height - nom) * w);
    const b = currHead.data.subarray(0, nom * w);
    if (greyStdDev(a) >= 8 && greyStdDev(b) >= 8 && meanAbsDiff(a, b) > 12) {
      return { kind: 'unverified', overlap: nominalOverlap, delta: 0, score: reg.score };
    }
  }
  return { kind: 'ok', overlap: nominalOverlap, delta: 0, score: reg.score };
}

export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / n;
}

export function greyStdDev(a: Uint8Array): number {
  const n = a.length;
  if (!n) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += a[i]!;
  mean /= n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i]! - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / n);
}
