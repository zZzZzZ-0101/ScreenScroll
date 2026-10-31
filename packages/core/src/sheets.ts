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
  /** Per column × 256 grey values: how many rows. */
  colHist: Uint32Array;
}

const LEVELS = 256;

export class SheetAnalyzer {
  private paper: number[] = [];
  private grey: number[] = [];
  private rows = 0;
  private readonly colPaper: Uint32Array;
  private readonly colHist: Uint32Array;
  private readonly bucketW: number;

  constructor(
    readonly width: number,
    readonly buckets = 64,
  ) {
    this.colPaper = new Uint32Array(width);
    this.colHist = new Uint32Array(width * LEVELS);
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
          this.colHist[x * LEVELS + v]!++;
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
      colHist: this.colHist.slice(),
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
const MIN_GAP = 2;
const MIN_SHEET = 120;
/** Share of the sheet columns that must look like the background for a gap row. */
const GAP_SHARE = 0.6;

/**
 * The viewer's background: the most common grey level in the columns at both edges, where a
 * viewer shows only its background (or a list beside the pages).
 */
function background(p: SheetProfile): number {
  const edge = Math.max(2, Math.round(0.02 * p.width));
  const counts = new Uint32Array(LEVELS);
  for (const x of [
    ...Array(edge).keys(),
    ...Array.from({ length: edge }, (_, i) => p.width - 1 - i),
  ])
    for (let l = 0; l < LEVELS; l++) counts[l]! += p.colHist[x * LEVELS + l]!;
  let best = 0;
  for (let l = 1; l < LEVELS; l++) if (counts[l]! > counts[best]!) best = l;
  return best;
}

/**
 * Finds the sheets, or null when the capture isn't a document viewer. Conservative on
 * purpose: an ordinary web page must never be cut into "sheets".
 *
 * Measured against the viewer's own background, not against white: pages of any colour
 * (scans, dark slides) count, and so does a very light viewer around white pages.
 * 1. Background grey B: the commonest level at the left and right edges.
 * 2. Sheet columns: the widest run of columns that differ from B in at least half as many
 *    rows as the most different column. Their commonest grey (the paper) must not be B.
 * 3. Gap rows: ≥ 60% of the buckets across the sheet columns within a tolerance of B
 *    (min(12, |255 − B| / 2 + 1), so 248 vs 255 still tells apart).
 * 4. Sheets: runs between gaps of ≥ 4 rows. A band as dark as B across a whole page looks
 *    like a gap, so neighbours that together make one typical page are joined again.
 */
/** What page detection reads from a capture: the column, the background and gap rows. */
export interface SheetEvidence {
  x0: number;
  x1: number;
  bg: number;
  paper: number;
  /** Per row: 1 where the row is background (or a page shadow) across the column. */
  gap: Uint8Array;
  height: number;
}

/**
 * The evidence for document pages, or null when the capture has no page-like column on a
 * background (an ordinary web page). Shared by detection and by the ranked alternatives.
 */
export function sheetEvidence(p: SheetProfile): SheetEvidence | null {
  const { width, height, buckets } = p;
  if (height < 2 * MIN_SHEET || width < 50) return null;
  const bg = background(p);
  const tol = Math.min(12, Math.abs(255 - bg) / 2 + 1, bg / 2 + 1);
  const lo = Math.max(0, Math.ceil(bg - tol));
  const hi = Math.min(LEVELS - 1, Math.floor(bg + tol));

  // Columns: how many rows differ from the background.
  const diff = new Uint32Array(width);
  let peak = 0;
  for (let x = 0; x < width; x++) {
    let same = 0;
    for (let l = lo; l <= hi; l++) same += p.colHist[x * LEVELS + l]!;
    diff[x] = height - same;
    peak = Math.max(peak, diff[x]!);
  }
  if (peak < MIN_SHEET) return null;
  const on = (x: number) => diff[x]! >= 0.5 * peak;
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
  let [x0, x1] = best;
  // There must be background beside the sheets to compare gaps with, and the sheets must be
  // a real column, not a sliver.
  const margin = 0.02 * width;
  if (x1 - x0 < 0.25 * width || (x0 < margin && width - x1 < margin)) return null;
  // Paper: the commonest grey inside the sheet columns. On an ordinary page that is the page's
  // own background (text on white around white), so it is not a viewer.
  // Counted in 8-level buckets: a scan's noisy paper spreads over several levels and must
  // still outweigh its ink, which sits on one.
  const inside = new Uint32Array(LEVELS / 8);
  for (let x = x0; x < x1; x++)
    for (let l = 0; l < LEVELS; l++) inside[l >> 3]! += p.colHist[x * LEVELS + l]!;
  let bucket = 0;
  for (let b = 1; b < inside.length; b++) if (inside[b]! > inside[bucket]!) bucket = b;
  // …then the commonest exact level within that bucket (255 and 248 share one).
  const levels = new Uint32Array(8);
  for (let x = x0; x < x1; x++)
    for (let i = 0; i < 8; i++) levels[i]! += p.colHist[x * LEVELS + bucket * 8 + i]!;
  let top = 0;
  for (let i = 1; i < 8; i++) if (levels[i]! > levels[top]!) top = i;
  const paper = bucket * 8 + top;
  if (Math.abs(paper - bg) <= Math.max(tol, 4)) return null;
  // Edges: a page's shadow and its anti-aliased edge column differ from the background in
  // every row, so they join the run, but they hold almost no paper. Trim columns with less
  // than half the paper of a typical inside column (else a dark line edges the page).
  const paperRows = (x: number) => {
    let n = 0;
    for (let l = Math.max(0, Math.round(paper - 12)); l <= Math.min(255, paper + 12); l++)
      n += p.colHist[x * LEVELS + l]!;
    return n;
  };
  const typicalPaper = median(
    Array.from({ length: Math.max(1, x1 - x0 - 6) }, (_, i) => paperRows(x0 + 3 + i)),
  );
  while (x1 - x0 > 2 && paperRows(x0) < 0.5 * typicalPaper) x0++;
  while (x1 - x0 > 2 && paperRows(x1 - 1) < 0.5 * typicalPaper) x1--;

  const bw = width / buckets;
  const inner: number[] = [];
  for (let b = 0; b < buckets; b++) if (b * bw >= x0 + 2 && (b + 1) * bw <= x1 - 2) inner.push(b);
  if (inner.length < 2) return null;

  // Like the columns: a page's shadow rows differ from the background but hold no paper.
  // A uniform row closer to the background than to the paper is shadow, not page.
  const shadowRow = (y: number) => {
    const at = y * buckets;
    let lo = 255;
    let hi = 0;
    let sum = 0;
    for (const b of inner) {
      const g = p.grey[at + b]!;
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
      sum += g;
    }
    const mean = sum / inner.length;
    return hi - lo <= 6 && Math.abs(mean - bg) < Math.abs(mean - paper);
  };
  // Rows: a gap row is mostly background across the sheet columns. Not all of it: whatever
  // the viewer dims behind its pages (a file list) can show through part of a gap.
  const gap = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    const at = y * buckets;
    let same = 0;
    for (const b of inner) if (Math.abs(p.grey[at + b]! - bg) <= tol) same++;
    gap[y] = same >= GAP_SHARE * inner.length || shadowRow(y) ? 1 : 0;
  }
  return { x0, x1, bg, paper, gap, height };
}

export function detectSheets(p: SheetProfile): SheetLayout | null {
  const ev = sheetEvidence(p);
  if (!ev) return null;
  const { x0, x1, gap, height } = ev;
  // Runs of non-gap rows are sheets; short gaps are part of a sheet.
  let sheets: Sheet[] = [];
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
    sheets.push({ y0: start, y1: end });
  }
  sheets = joinSplitSheets(sheets);
  sheets = sheets.filter((s) => s.y1 - s.y0 >= MIN_SHEET);
  sheets = regainEdgeBands(sheets, height);
  if (sheets.length < 2) return null;

  // Whole sheets (not the first or last, which the capture may cut) are similar in height.
  const whole = sheets.slice(1, -1).map((s) => s.y1 - s.y0);
  const ref = whole.length ? median(whole) : Math.max(...sheets.map((s) => s.y1 - s.y0));
  if (whole.some((h) => Math.abs(h - ref) > 0.25 * ref)) return null;
  if (sheets.some((s) => s.y1 - s.y0 > 1.3 * ref)) return null;
  return { x0, x1, sheets };
}

/**
 * Documents have pages of one size (or a few). Pieces shorter than a typical page whose
 * span, gap included, makes one typical page (±3%) are one page that a dark band split.
 */
function joinSplitSheets(sheets: Sheet[]): Sheet[] {
  const heights = sheets.map((s) => s.y1 - s.y0).filter((h) => h >= MIN_SHEET);
  if (heights.length < 2) return sheets;
  const typical =
    Math.max(
      ...heights.filter((h) => heights.filter((k) => Math.abs(k - h) <= 0.03 * h).length >= 2),
      0,
    ) || median(heights);
  const out: Sheet[] = [];
  for (let i = 0; i < sheets.length; i++) {
    let cur = sheets[i]!;
    // Join forward while the joined span still fits one page.
    while (i + 1 < sheets.length && cur.y1 - cur.y0 < 0.97 * typical) {
      const next = sheets[i + 1]!;
      const span = next.y1 - cur.y0;
      if (span > 1.03 * typical) break;
      cur = { y0: cur.y0, y1: next.y1 };
      i++;
    }
    out.push(cur);
  }
  return out;
}

/**
 * A band as dark as the background at the very top or bottom of a page merges into the gap
 * next to it: the page comes out short and that gap long by about the same amount. Give the
 * page those rows back when the numbers agree (±3 px) with the typical page and gap.
 */
function regainEdgeBands(sheets: Sheet[], height: number): Sheet[] {
  if (sheets.length < 3) return sheets;
  const hs = sheets.map((s) => s.y1 - s.y0);
  // Whole pages only: the first and last may be cut by the capture.
  const typical = median(hs.slice(1, -1));
  const gaps = sheets.slice(1).map((s, i) => s.y0 - sheets[i]!.y1);
  const g = median(gaps);
  return sheets.map((s, i) => {
    const missing = typical - (s.y1 - s.y0);
    if (missing <= 3) return s;
    const before = i > 0 ? s.y0 - sheets[i - 1]!.y1 : s.y0;
    const after = i < sheets.length - 1 ? sheets[i + 1]!.y0 - s.y1 : height - s.y1;
    if (Math.abs(before - missing - g) <= 3) return { y0: s.y0 - missing, y1: s.y1 };
    if (Math.abs(after - missing - g) <= 3) return { y0: s.y0, y1: s.y1 + missing };
    return s;
  });
}

/** Pages set by hand: a column and a repeating page height with a gap, in capture px. */
export interface SheetGrid {
  x0: Px;
  x1: Px;
  /** Top of the first page. */
  top: Px;
  height: Px;
  gap: Px;
}

/**
 * The pages a grid makes, down to the end of the capture. The last page may be cut by the
 * capture; one shorter than a fifth of a page is left out (a sliver, not a page).
 */
export function gridSheets(g: SheetGrid, height: number): SheetLayout | null {
  const x0 = Math.max(0, Math.round(g.x0));
  const x1 = Math.round(g.x1);
  const h = Math.round(g.height);
  const gap = Math.max(0, Math.round(g.gap));
  if (x1 - x0 < 20 || h < 20 || g.top < 0 || g.top >= height) return null;
  const sheets: Sheet[] = [];
  for (let y = Math.round(g.top); y < height && sheets.length < 2000; y += h + gap) {
    const y1 = Math.min(y + h, height);
    if (y1 - y >= 0.2 * h || sheets.length === 0) sheets.push({ y0: y, y1 });
  }
  return { x0, x1, sheets };
}

/** A grid that reproduces a detected layout: its first page, median height and gap. */
export function gridOf(l: SheetLayout): SheetGrid {
  const hs = l.sheets.map((s) => s.y1 - s.y0);
  const gaps = l.sheets.slice(1).map((s, i) => s.y0 - l.sheets[i]!.y1);
  return {
    x0: l.x0,
    x1: l.x1,
    top: l.sheets[0]?.y0 ?? 0,
    height: hs.length > 2 ? median(hs.slice(1, -1)) : Math.max(...hs),
    gap: gaps.length ? median(gaps) : 0,
  };
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

/** A way to read the capture as pages, with how well the pixels support it. */
export interface SheetCandidate {
  id: string;
  /** Plain name: "Found from the gaps", "A4 pages"… */
  label: string;
  /** The grid behind it, or null for the layout found from the gaps. */
  grid: SheetGrid | null;
  layout: SheetLayout;
  /** 0…1: how well the layout matches the background rows the capture shows. */
  fit: number;
  /** Share of belief among the alternatives offered (they add up to 1). */
  probability: number;
}

/** Page shapes (height ÷ width) common in viewers: paper, then slides. */
const SHAPES: Array<[string, string, number]> = [
  ['a4', 'A4 pages', Math.SQRT2],
  ['letter', 'Letter pages', 11 / 8.5],
  ['legal', 'Legal pages', 14 / 8.5],
  ['a4-land', 'A4 landscape pages', 1 / Math.SQRT2],
  ['slides-16-9', '16:9 slides', 9 / 16],
  ['slides-4-3', '4:3 slides', 3 / 4],
];

/**
 * How well a layout explains the evidence, 0…1: rows between its pages should be
 * background, rows inside them should not, and no long background run should sit inside a
 * page unexplained.
 */
export function layoutFit(ev: SheetEvidence, l: SheetLayout): number {
  if (!l.sheets.length) return 0;
  let between = 0;
  let betweenGap = 0;
  let inside = 0;
  let insideGap = 0;
  let unexplained = 0;
  l.sheets.forEach((s, i) => {
    let run = 0;
    for (let y = Math.max(0, s.y0 + 2); y < Math.min(ev.height, s.y1 - 2); y++) {
      inside++;
      if (ev.gap[y]) {
        insideGap++;
        if (++run === 6) unexplained++;
      } else run = 0;
    }
    const next = l.sheets[i + 1];
    if (next) {
      // Pages that touch are judged on the rows right at the join.
      const a = next.y0 > s.y1 ? s.y1 : s.y1 - 1;
      const b = next.y0 > s.y1 ? next.y0 : s.y1 + 1;
      for (let y = Math.max(0, a); y < Math.min(ev.height, b); y++) {
        between++;
        betweenGap += ev.gap[y]!;
      }
    }
  });
  const gapFit = between ? betweenGap / between : 0.5;
  const pageFit = inside ? 1 - insideGap / inside : 0;
  return gapFit * pageFit * Math.exp(-unexplained / l.sheets.length);
}

/**
 * Ranked ways to read a document viewer capture as pages (M7 "several interpretations"):
 * the layout found from the gaps, and grids of common page shapes at the column's width,
 * each placed on a page top the capture shows. Each gets a fit; probabilities are a softmax
 * of the fits (sharp: a clearly better reading takes most of the belief). Readings that put
 * the same breaks within 3 px are one.
 */
export function sheetCandidates(
  ev: SheetEvidence | null,
  detected: SheetLayout | null,
  max = 3,
  /** CSS px per analysis column: rows are CSS px, columns may be scaled down. */
  colScale = 1,
): SheetCandidate[] {
  if (!ev) return [];
  const width = (ev.x1 - ev.x0) * colScale;
  const out: Array<Omit<SheetCandidate, 'probability'>> = [];
  if (detected)
    out.push({
      id: 'gaps',
      label: 'Found from the gaps',
      grid: null,
      layout: detected,
      fit: layoutFit(ev, detected),
    });
  // Gap length: the commonest run of background rows between content (1–80 rows).
  const runs = new Map<number, number>();
  const tops: number[] = [];
  for (let y = 0, run = 0; y < ev.height; y++) {
    if (ev.gap[y]) run++;
    else {
      if (run >= 1 && run <= 80) runs.set(run, (runs.get(run) ?? 0) + 1);
      if (run >= 1 || y === 0) tops.push(y);
      run = 0;
    }
  }
  let gap = 0;
  let seen = 0;
  for (const [len, n] of runs) if (n > seen || (n === seen && len < gap)) [gap, seen] = [len, n];
  for (const [id, label, shape] of SHAPES) {
    const height = Math.round(width * shape);
    if (height < MIN_SHEET || height > ev.height * 1.5) continue;
    let best: Omit<SheetCandidate, 'probability'> | null = null;
    for (const top of tops.slice(0, 40)) {
      // Back up whole pages so the grid also covers what is above this top.
      const first = top - Math.floor(top / (height + gap)) * (height + gap);
      const grid = { x0: ev.x0, x1: ev.x1, top: first, height, gap };
      const layout = gridSheets(grid, ev.height);
      if (!layout) continue;
      const fit = layoutFit(ev, layout);
      if (!best || fit > best.fit) best = { id, label, grid, layout, fit };
    }
    if (best) out.push(best);
  }
  const same = (a: SheetLayout, b: SheetLayout) =>
    a.sheets.length === b.sheets.length &&
    a.sheets.every(
      (s, i) => Math.abs(s.y1 - b.sheets[i]!.y1) <= 3 && Math.abs(s.y0 - b.sheets[i]!.y0) <= 3,
    );
  const kept: typeof out = [];
  for (const c of [...out].sort((a, b) => b.fit - a.fit))
    if (!kept.some((k) => same(k.layout, c.layout))) kept.push(c);
  const top = kept.slice(0, max);
  const weights = top.map((c) => Math.exp(12 * c.fit));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return top.map((c, i) => ({ ...c, probability: weights[i]! / sum }));
}

/** A reading this good is used without asking when the gaps found nothing. */
export const CONFIDENT_FIT = 0.9;

export function confidentReading(readings: readonly SheetCandidate[]): SheetCandidate | null {
  const r = readings[0];
  return r && r.fit >= CONFIDENT_FIT ? r : null;
}
