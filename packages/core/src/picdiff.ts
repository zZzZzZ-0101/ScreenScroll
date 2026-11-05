import { diffSeq } from './diff.js';
import type { Interval } from './geometry.js';
import type { GreyImage } from './image.js';

/**
 * M8 "what changed" for pictures. Each capture is cut into blocks: runs of rows with ink,
 * separated by blank rows (a line of text, a picture), longer runs in fixed slices from
 * their top. Blocks are aligned with the same longest-common-subsequence as the text diff,
 * so content that moved because something was inserted or removed above it still matches,
 * by any number of pixels. What doesn't align is a change: removed from the older capture,
 * added to the newer one.
 */
const COLS = 64;
/** Vertical cells per block fingerprint. */
const ROWS = 4;
/** Longer runs of ink (pictures, dense tables) are compared in slices this tall. */
const SLICE = 96;
/** A row whose pixels span less than this is blank. */
const BLANK_SPAN = 20;
/** Mean grey per cell may differ this much (JPEG noise, anti-aliasing) and still match. */
const TOLERANCE = 5;

export interface PictureBlock {
  y0: number;
  y1: number;
  /** Ink extent in fingerprint columns (pixels of the printer's width). */
  x0: number;
  x1: number;
  print: Uint8Array;
}

/** Streams grey rows (any number per push, e.g. one frame's) into blocks. */
export class BlockPrinter {
  readonly blocks: PictureBlock[] = [];
  private y = 0;
  private open: { y0: number; rows: Uint8Array[]; x0: number; x1: number } | null = null;
  private bg = 255;

  constructor(readonly width: number) {}

  push(img: GreyImage): void {
    if (img.width !== this.width) throw new Error('BlockPrinter: width changed');
    const w = this.width;
    for (let r = 0; r < img.height; r++, this.y++) {
      const row = img.data.subarray(r * w, (r + 1) * w);
      let lo = 255;
      let hi = 0;
      for (let x = 0; x < w; x++) {
        const v = row[x]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo < BLANK_SPAN) {
        this.bg = (lo + hi) >> 1;
        this.close();
        continue;
      }
      const o = (this.open ??= { y0: this.y, rows: [], x0: w, x1: 0 });
      for (let x = 0; x < w; x++)
        if (Math.abs(row[x]! - this.bg) > BLANK_SPAN) {
          if (x < o.x0) o.x0 = x;
          if (x + 1 > o.x1) o.x1 = x + 1;
        }
      o.rows.push(cells(row));
      if (o.rows.length === SLICE) this.close();
    }
  }

  finish(): PictureBlock[] {
    this.close();
    return this.blocks;
  }

  private close(): void {
    const o = this.open;
    if (!o) return;
    this.open = null;
    const n = o.rows.length;
    const print = new Uint8Array(1 + ROWS * COLS);
    // The height is part of the fingerprint: a line that grew or shrank is a change.
    print[0] = Math.min(255, n);
    for (let k = 0; k < ROWS; k++) {
      const r0 = Math.floor((k * n) / ROWS);
      const r1 = Math.max(r0 + 1, Math.floor(((k + 1) * n) / ROWS));
      for (let c = 0; c < COLS; c++) {
        let s = 0;
        for (let r = r0; r < Math.min(r1, n); r++) s += o.rows[r]![c]!;
        print[1 + k * COLS + c] = Math.round(s / (Math.min(r1, n) - r0));
      }
    }
    this.blocks.push({ y0: o.y0, y1: o.y0 + n, x0: o.x0, x1: Math.max(o.x0 + 1, o.x1), print });
  }
}

function cells(row: Uint8Array): Uint8Array {
  const w = row.length;
  const out = new Uint8Array(COLS);
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor((c * w) / COLS);
    const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / COLS));
    let s = 0;
    for (let x = x0; x < x1; x++) s += row[x]!;
    out[c] = Math.round(s / (x1 - x0));
  }
  return out;
}

export interface PictureChange {
  /** Rows of the older capture that are gone or different, if any. */
  removed: Interval | null;
  /** Rows of the newer capture that are new or different, if any. */
  added: Interval | null;
  /** Columns with ink in either side of the change, in printer pixels. */
  x0: number;
  x1: number;
}

const same = (a: PictureBlock, b: PictureBlock) => {
  if (Math.abs(a.print[0]! - b.print[0]!) > 1) return false;
  for (let i = 1; i < a.print.length; i++)
    if (Math.abs(a.print[i]! - b.print[i]!) > TOLERANCE) return false;
  return true;
};

/**
 * Changed areas, top to bottom. Each pairs what went (older) with what came (newer) at
 * the same place in the reading order; either side can be empty.
 */
export function diffPictures(
  older: readonly PictureBlock[],
  newer: readonly PictureBlock[],
): PictureChange[] {
  const out: PictureChange[] = [];
  let cur: PictureChange | null = null;
  const take = (iv: Interval | null, b: PictureBlock): Interval =>
    iv ? { y0: iv.y0, y1: b.y1 } : { y0: b.y0, y1: b.y1 };
  for (const op of diffSeq(older, newer, same)) {
    if (op.kind === 'same') {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    cur ??= { removed: null, added: null, x0: Infinity, x1: 0 };
    const b = op.kind === 'del' ? op.a : op.b;
    if (op.kind === 'del') cur.removed = take(cur.removed, b);
    else cur.added = take(cur.added, b);
    cur.x0 = Math.min(cur.x0, b.x0);
    cur.x1 = Math.max(cur.x1, b.x1);
  }
  if (cur) out.push(cur);
  return out;
}
