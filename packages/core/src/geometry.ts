export type Px = number;

export interface Rect {
  x: Px;
  y: Px;
  width: Px;
  height: Px;
}

export interface Interval {
  y0: Px;
  y1: Px;
}

export function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, x1 - x), height: Math.max(0, y1 - y) };
}

/** Sorts and merges overlapping or touching intervals. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.y0 - b.y0 || a.y1 - b.y1);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out.at(-1);
    if (last && iv.y0 <= last.y1) last.y1 = Math.max(last.y1, iv.y1);
    else out.push({ ...iv });
  }
  return out;
}
