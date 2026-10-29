import type { GreyImage } from './image.js';
import type { Px } from './geometry.js';
import type { PageLayout } from './layout.js';
import type { PageSlice } from './paginate.js';

/**
 * Document viewers (Google Drive, Docs previews, PDF viewers, Office Online) show a stack of
 * light sheets with gaps, on a background that also shows beside them. When a capture has
 * that shape, its pages are already decided: one output page per sheet, cropped to the sheet.
 *
 * Streaming like RowAnalyzer: per row, per column bucket, the share of "paper" pixels and
 * the mean grey; per column, how many paper pixels it has overall.
 */
export const PAPER_GREY = 246;

export interface SheetProfile {
  width: number;
  height: number;
  buckets: number;
  /** Per row × bucket: share of paper pixels, 0…255. */
  paper: Uint8Array;
  /** Per row × bucket: mean grey. */
  grey: Uint8Array;
  /** Per column: rows where the pixel is paper. */
  colPaper: Uint32Array;
}

export class SheetAnalyzer {
  private paper: number[] = [];
  private grey: number[] = [];
  private rows = 0;
  private readonly colPaper: Uint32Array;
  private readonly bucketW: number;

  constructor(
    readonly width: number,
    readonly buckets = 64,
  ) {
    this.colPaper = new Uint32Array(width);
    this.bucketW = width / buckets;
  }

  push(img: GreyImage): void {
    if (img.width !== this.width) throw new Error('Sheet analyzer: width mismatch');
    for (let y = 0; y < img.height; y++) {
      const row = img.data.subarray(y * img.width, (y + 1) * img.width);
      for (let b = 0; b < this.buckets; b++) {
        const x0 = Math.floor(b * this.bucketW);
        const x1 = Math.max(x0 + 1, Math.floor((b + 1) * this.bucketW));
        let paper = 0;
        let sum = 0;
        for (let x = x0; x < x1; x++) {
          const v = row[x]!;
          sum += v;
          if (v >= PAPER_GREY) {
            paper++;
            this.colPaper[x]!++;
          }
        }
        this.paper.push(Math.round((paper / (x1 - x0)) * 255));
        this.grey.push(Math.round(sum / (x1 - x0)));
      }
      this.rows++;
    }
  }

  finish(): SheetProfile {
    return {
      width: this.width,
      height: this.rows,
      buckets: this.buckets,
      paper: Uint8Array.from(this.paper),
      grey: Uint8Array.from(this.grey),
      colPaper: this.colPaper.slice(),
    };
  }
}

export interface Sheet {
  y0: Px;
  y1: Px;
}

export interface SheetLayout {
  /** Column range shared by every sheet, in profile px. */
  x0: Px;
  x1: Px;
  sheets: Sheet[];
}

/** Gaps shorter than this are inside a sheet (a rule, a dark table border). */
const MIN_GAP = 4;
const MIN_SHEET = 120;

/**
 * Finds the sheets, or null when the capture isn't a document viewer. Conservative on
 * purpose: an ordinary web page must never be cut into "sheets".
 */
export function detectSheets(p: SheetProfile): SheetLayout | null {
  const { width, height, buckets } = p;
  if (height < 2 * MIN_SHEET || width < 50) return null;

  // Columns: the sheets are the widest run of columns that are mostly paper.
  let peak = 0;
  for (const c of p.colPaper) peak = Math.max(peak, c);
  if (peak < MIN_SHEET) return null;
  const on = (x: number) => p.colPaper[x]! >= 0.5 * peak;
  let best: [number, number] | null = null;
  for (let x = 0; x < width;) {
    if (!on(x)) {
      x++;
      continue;
    }
    let e = x;
    while (e < width && on(e)) e++;
    if (!best || e - x > best[1] - best[0]) best = [x, e];
    x = e;
  }
  if (!best) return null;
  const [x0, x1] = best;
  // There must be background beside the sheets to compare gaps with, and the sheets must be
  // a real column, not a sliver.
  const margin = 0.02 * width;
  if (x1 - x0 < 0.25 * width || (x0 < margin && width - x1 < margin)) return null;

  const bw = width / buckets;
  const inner: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const bx0 = b * bw;
    const bx1 = (b + 1) * bw;
    if (bx0 >= x0 + 2 && bx1 <= x1 - 2) inner.push(b);
    else if (bx1 <= x0 - 2) left.push(b);
    else if (bx0 >= x1 + 2) right.push(b);
  }
  if (inner.length < 2 || !(left.length || right.length)) return null;
  const mean = (list: number[], at: number) =>
    list.reduce((n, b) => n + p.grey[at + b]!, 0) / list.length;

  // Rows: a gap row has no paper inside the column and looks like the background beside it
  // on at least one side (the other side may show something else, like a dimmed file list).
  const gap = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    const at = y * buckets;
    let paper = 0;
    let gin = 0;
    for (const b of inner) {
      paper += p.paper[at + b]!;
      gin += p.grey[at + b]!;
    }
    paper /= inner.length * 255;
    gin /= inner.length;
    const like = (side: number[]) => side.length > 0 && Math.abs(gin - mean(side, at)) <= 14;
    gap[y] = paper < 0.05 && (like(left) || like(right)) ? 1 : 0;
  }

  // Runs of non-gap rows are sheets; short gaps are part of a sheet.
  const sheets: Sheet[] = [];
  let y = 0;
  while (y < height) {
    while (y < height && gap[y]) y++;
    if (y >= height) break;
    const start = y;
    let end = y;
    while (y < height) {
      if (!gap[y]) {
        end = ++y;
        continue;
      }
      let g = y;
      while (g < height && gap[g]) g++;
      if (g - y >= MIN_GAP || g >= height) break;
      y = g;
    }
    if (end - start >= MIN_SHEET) sheets.push({ y0: start, y1: end });
  }
  if (sheets.length < 2) return null;

  // Whole sheets (not the first or last, which the capture may cut) are similar in height.
  const whole = sheets.slice(1, -1).map((s) => s.y1 - s.y0);
  const ref = whole.length ? median(whole) : Math.max(...sheets.map((s) => s.y1 - s.y0));
  if (whole.some((h) => Math.abs(h - ref) > 0.25 * ref)) return null;
  if (sheets.some((s) => s.y1 - s.y0 > 1.3 * ref)) return null;
  return { x0, x1, sheets };
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** One output page per sheet: no breaks to choose, no overlap, nothing cut. */
export function sheetSlices(l: SheetLayout): PageSlice[] {
  return l.sheets.map((sh, i) => ({
    y0: sh.y0,
    y1: sh.y1,
    x0: l.x0,
    x1: l.x1,
    overlapTop: 0,
    breakKind: i === l.sheets.length - 1 ? 'end' : 'section',
    cost: 0,
    warnings: [],
  }));
}

/**
 * Makes every sheet fit its paper page: scales down when the tallest sheet is taller than
 * the printable box (a landscape sheet on portrait paper), and centres the sheet
 * horizontally in the box when that leaves room at the sides.
 */
export function fitSheets(layout: PageLayout, l: SheetLayout): PageLayout {
  const width = l.x1 - l.x0;
  const tallest = Math.max(...l.sheets.map((sh) => sh.y1 - sh.y0));
  const s = Math.min(layout.s, layout.box.h / tallest);
  const w = width * s;
  return {
    ...layout,
    s,
    T: layout.box.h / s,
    box: { ...layout.box, x: layout.box.x + (layout.box.w - w) / 2, w },
  };
}
