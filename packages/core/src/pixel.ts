import type { GreyImage } from './image.js';

/**
 * First port of the reference prototype (reference/split_tall_pdf.py):
 * "ink" = pixels darker than a threshold. Kept as a baseline; the row-uniformity
 * analysis from PAGINATION §4 replaces it in M2.
 */
export const INK_THRESHOLD = 200;

/** Dark-pixel count per row, sampling every `step`-th column like the prototype. */
export function rowInk(img: GreyImage, threshold = INK_THRESHOLD, step = 2): Uint32Array {
  const { width, height, data } = img;
  const out = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let n = 0;
    for (let x = 0; x < width; x += step) if (data[base + x]! < threshold) n++;
    out[y] = n;
  }
  return out;
}

/** Content columns `[x0, x1)` with ink, padded; null when the image is blank. */
export function inkColumns(
  img: GreyImage,
  pad: number,
  threshold = INK_THRESHOLD,
  rowStep = 3,
): { x0: number; x1: number } | null {
  const { width, height, data } = img;
  let first = -1;
  let last = -1;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y += rowStep) {
      if (data[y * width + x]! < threshold) {
        if (first < 0) first = x;
        last = x;
        break;
      }
    }
  }
  if (first < 0) return null;
  return { x0: Math.max(0, first - pad), x1: Math.min(width, last + 1 + pad) };
}

/**
 * Greedy page cutting from the prototype: for each page, cut at the least-ink row
 * within [70%, 100%] of the target height, preferring lower rows on ties.
 * Returns cut rows including 0 and `height`.
 */
export function greedyCuts(ink: ArrayLike<number>, target: number, minFill = 0.7): number[] {
  const height = ink.length;
  const cuts = [0];
  let top = 0;
  while (height - top > target) {
    const lo = Math.floor(top + target * minFill);
    const hi = Math.floor(top + target);
    let best = lo;
    for (let r = lo; r < hi; r++) if (ink[r]! <= ink[best]!) best = r;
    // Guard against a zero-length page when target < 1 row.
    if (best <= top) best = top + Math.max(1, Math.floor(target));
    cuts.push(best);
    top = best;
  }
  cuts.push(height);
  return cuts;
}
