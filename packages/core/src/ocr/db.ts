import type { DetConfig } from './types.js';

export interface DetBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mean text probability inside the box before growing it. */
  score: number;
  /** Touches a tile edge inside the image, so the text may continue in the next tile. */
  cut?: boolean;
}

/**
 * DB post-processing (Liao et al., "Real-time Scene Text Detection with Differentiable
 * Binarization", 2020) for screen text, which is upright: threshold the probability map,
 * take 8-connected regions, score each by its mean probability over its bounding box, and
 * grow the box by d = area · unclipRatio / perimeter on every side (the model is trained on
 * regions shrunk by that rule). Boxes are axis-aligned; rotated text is out of scope.
 */
export function dbBoxes(
  prob: Float32Array,
  width: number,
  height: number,
  cfg: Pick<
    DetConfig,
    'threshold' | 'boxThreshold' | 'unclipRatio' | 'minimumBoxSide' | 'maxCandidates'
  >,
): DetBox[] {
  const label = new Int32Array(width * height);
  const boxes: DetBox[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < prob.length; start++) {
    if (label[start] || prob[start]! <= cfg.threshold) continue;
    if (++next > cfg.maxCandidates) break;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (!label[j] && prob[j]! > cfg.threshold) {
            label[j] = next;
            stack.push(j);
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (Math.min(w, h) < cfg.minimumBoxSide) continue;
    let sum = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sum += prob[y * width + x]!;
    const score = sum / (w * h);
    if (score < cfg.boxThreshold) continue;
    const d = (w * h * cfg.unclipRatio) / (2 * (w + h));
    const bx = Math.max(0, x0 - d);
    const by = Math.max(0, y0 - d);
    const box = {
      x: bx,
      y: by,
      w: Math.min(width, x1 + 1 + d) - bx,
      h: Math.min(height, y1 + 1 + d) - by,
      score,
    };
    if (Math.min(box.w, box.h) < cfg.minimumBoxSide + 2) continue;
    boxes.push(box);
  }
  return boxes;
}

const area = (b: DetBox) => b.w * b.h;
function intersection(a: DetBox, b: DetBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Boxes from overlapping tiles describe the same text twice (IoU > 0.5, or 80% of the
 * smaller box covered). Keep a box that doesn't touch a tile's inner edge over one that does
 * (that one may be cut off), then the higher score: the bundle's own merge order.
 */
export function mergeTileBoxes(boxes: DetBox[]): DetBox[] {
  const sorted = [...boxes].sort((a, b) => Number(!!a.cut) - Number(!!b.cut) || b.score - a.score);
  const kept: DetBox[] = [];
  for (const b of sorted) {
    const dup = kept.some((k) => {
      const i = intersection(k, b);
      return i / (area(k) + area(b) - i) > 0.5 || i / Math.min(area(k), area(b)) > 0.8;
    });
    if (!dup) kept.push(b);
  }
  return kept;
}

/** Tiles of at most `side` px overlapping by `overlap`, covering a w × h image. */
export function tiles(w: number, h: number, side: number, overlap: number) {
  const starts = (n: number) => {
    if (n <= side) return [0];
    const out: number[] = [];
    for (let s = 0; s + side < n; s += side - overlap) out.push(s);
    out.push(n - side);
    return out;
  };
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const y of starts(h))
    for (const x of starts(w)) out.push({ x, y, w: Math.min(side, w), h: Math.min(side, h) });
  return out;
}
