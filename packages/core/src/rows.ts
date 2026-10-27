import type { Px } from './geometry.js';
import type { GreyImage } from './image.js';

/**
 * Per-row analysis of a long capture (PAGINATION §4), built incrementally so frames can be
 * streamed through without holding the whole image.
 */
export interface RowProfile {
  /** Analysis rows per CSS px. */
  rowsPerPx: number;
  width: number;
  height: number;
  /** 0 = ink, 1 = uniform, 2 = only thin vertical rules (table borders). */
  safe: Uint8Array;
  /** Dominant grey value of each row. */
  mode: Uint8Array;
  /** Pixels whose grey changes by more than τ from the row above: what a cut here would split. */
  damage: Uint16Array;
  /** Per column: rows where the pixel is off its row's dominant colour (for side-cropping). */
  colInk: Uint32Array;
}

export interface RowOptions {
  /** Max deviation from the row's mode still counted as uniform (default 12, JPEG-tolerant). */
  tau: number;
  /** Columns ignored at each edge: scrollbars and frame borders (default 6). */
  edge: number;
  /** Max share of the width a rule-only row may cover (default 1.5%). */
  ruleShare: number;
}

export const DEFAULT_ROW_OPTIONS: RowOptions = { tau: 12, edge: 6, ruleShare: 0.015 };

export class RowAnalyzer {
  private safe: number[] = [];
  private mode: number[] = [];
  private damage: number[] = [];
  private prev: Uint8Array | null = null;
  private prevMode = -1;
  private readonly colInk: Uint32Array;
  /** Per column: rows in a row that were off-mode (vertical stroke length so far). */
  private readonly vertRun: Uint32Array;
  /** Rows with few off-mode pixels, waiting to see whether those columns continue below. */
  private pending: Array<{ row: number; cols: Int32Array }> = [];
  private ruleRows: number[] = [];
  /** A rule must run this many rows above and below the row (descender stems don't). */
  private readonly ruleReach: number;
  private readonly opts: RowOptions;

  constructor(
    readonly width: number,
    readonly rowsPerPx: number,
    opts: Partial<RowOptions> = {},
  ) {
    this.opts = { ...DEFAULT_ROW_OPTIONS, ...opts };
    this.colInk = new Uint32Array(width);
    this.vertRun = new Uint32Array(width);
    this.ruleReach = Math.max(2, Math.round(8 * rowsPerPx));
  }

  push(img: GreyImage): void {
    if (img.width !== this.width) throw new Error('Row analyzer: width mismatch');
    const { tau, edge, ruleShare } = this.opts;
    const x0 = Math.min(edge, this.width >> 2);
    const x1 = this.width - x0;
    const maxRule = Math.max(1, Math.floor((x1 - x0) * ruleShare));
    const hist = new Uint32Array(256);
    for (let y = 0; y < img.height; y++) {
      const row = img.data.subarray(y * img.width, (y + 1) * img.width);
      hist.fill(0);
      for (let x = x0; x < x1; x++) hist[row[x]!]!++;
      // The row's dominant colour at τ resolution: the window [m−τ, m+τ] holding the most
      // pixels. A single most-common value can sit at the edge of JPEG noise and flag the
      // rest of the noise as ink.
      const span = 2 * tau + 1;
      let inWin = 0;
      for (let v = 0; v < Math.min(span, 256); v++) inWin += hist[v]!;
      let best = inWin;
      let bestStart = 0;
      for (let start = 1; start + span <= 256; start++) {
        inWin += hist[start + span - 1]! - hist[start - 1]!;
        if (inWin > best) {
          best = inWin;
          bestStart = start;
        }
      }
      const m = Math.min(255, bestStart + tau);
      const off = x1 - x0 - best;
      // Vertical stroke lengths. A row of a different colour (a horizontal rule, a zebra
      // stripe edge) neither extends nor breaks a stroke; any other clean pixel ends it.
      const colourChange = this.prevMode >= 0 && Math.abs(m - this.prevMode) > tau;
      for (let x = x0; x < x1; x++) {
        if (Math.abs(row[x]! - m) > tau) {
          this.vertRun[x]!++;
          this.colInk[x]!++;
        } else if (!colourChange) this.vertRun[x] = 0;
      }
      const index = this.safe.length;
      if (off > 0 && off <= maxRule) {
        const cols = new Int32Array(off);
        let k = 0;
        for (let x = x0; x < x1; x++) if (Math.abs(row[x]! - m) > tau) cols[k++] = x;
        this.pending.push({ row: index, cols });
      }
      // Rule-only rows: few off-mode pixels, each part of a stroke that runs ruleReach rows
      // above and below (table borders, card edges). Text descenders are much shorter.
      const reach = this.ruleReach;
      while (this.pending.length && this.pending[0]!.row <= index - reach) {
        const cand = this.pending.shift()!;
        if (cand.row === index - reach && this.strokesSpan(cand.cols, 2 * reach + 1)) {
          this.ruleRows.push(cand.row);
        }
      }
      let dmg = 0;
      if (this.prev) {
        for (let x = x0; x < x1; x++) if (Math.abs(row[x]! - this.prev[x]!) > tau) dmg++;
      }
      this.safe.push(off === 0 ? 1 : 0);
      this.mode.push(m);
      this.damage.push(Math.min(dmg, 0xffff));
      this.prev = row.slice();
      this.prevMode = m;
    }
  }

  /** Every column (±1 px) has a vertical stroke at least `len` rows long ending now. */
  private strokesSpan(cols: Int32Array, len: number): boolean {
    for (const x of cols) {
      const best = Math.max(this.vertRun[x - 1] ?? 0, this.vertRun[x]!, this.vertRun[x + 1] ?? 0);
      if (best < len) return false;
    }
    return true;
  }

  finish(): RowProfile {
    const n = this.safe.length;
    const safe = Uint8Array.from(this.safe);
    // Rows within ruleReach of the end never qualify: what follows them is unknown.
    for (const r of this.ruleRows) safe[r] = 2;
    return {
      rowsPerPx: this.rowsPerPx,
      width: this.width,
      height: n,
      safe,
      mode: Uint8Array.from(this.mode),
      damage: Uint16Array.from(this.damage),
      colInk: this.colInk.slice(),
    };
  }
}

export function analyzeRows(
  img: GreyImage,
  rowsPerPx = 1,
  opts: Partial<RowOptions> = {},
): RowProfile {
  const a = new RowAnalyzer(img.width, rowsPerPx, opts);
  a.push(img);
  return a.finish();
}

/** A maximal run of safe rows `[r0, r1)` (row indices). */
export interface Gap {
  r0: number;
  r1: number;
  /** Contains rule-only rows (inside a table). */
  rule: boolean;
}

export function findGaps(p: RowProfile): Gap[] {
  const gaps: Gap[] = [];
  let start = -1;
  let rule = false;
  for (let y = 0; y <= p.height; y++) {
    const s = y < p.height ? p.safe[y]! : 0;
    if (s && start < 0) {
      start = y;
      rule = false;
    }
    if (s === 2) rule = true;
    if (!s && start >= 0) {
      gaps.push({ r0: start, r1: y, rule });
      start = -1;
    }
  }
  return gaps;
}

/**
 * Typical gap between text lines, in rows: the median gap between two short ink runs
 * (runs under 3× the median run height, i.e. text lines). Null without enough text.
 */
export function estimateLineGap(p: RowProfile, gaps: readonly Gap[] = findGaps(p)): number | null {
  const runs: Array<{ r0: number; r1: number }> = [];
  let prevEnd = 0;
  for (const g of gaps) {
    if (g.r0 > prevEnd) runs.push({ r0: prevEnd, r1: g.r0 });
    prevEnd = g.r1;
  }
  if (p.height > prevEnd) runs.push({ r0: prevEnd, r1: p.height });
  if (runs.length < 3) return null;
  const medRun = median(runs.map((r) => r.r1 - r.r0));
  const short = (r: { r0: number; r1: number }) => r.r1 - r.r0 < 3 * medRun;
  const between: number[] = [];
  for (let i = 1; i < runs.length; i++) {
    if (short(runs[i - 1]!) && short(runs[i]!)) between.push(runs[i]!.r0 - runs[i - 1]!.r1);
  }
  return between.length ? median(between) : null;
}

export type PixelKind = 'section' | 'paragraph' | 'tableRow' | 'line';

/** Penalty for cutting just below a heading-like line (as keep-with-next in PAGINATION §2). */
const HEADING_ABOVE = 40;
/** Penalty for leaving a block's first line alone at the bottom of a page. */
const ORPHAN = 6;

export interface PixelCandidate {
  /** Cut position in CSS px: the centre of the gap. */
  y: Px;
  kind: PixelKind;
  badness: number;
  /** Gap extent in CSS px. */
  y0: Px;
  y1: Px;
}

/**
 * PAGINATION §2/§4: candidates from pixel gaps, graded by height relative to the line gap.
 * Cuts go to the centre of each gap so both pages keep half the whitespace.
 */
export function pixelCandidates(
  p: RowProfile,
  gaps: readonly Gap[] = findGaps(p),
): PixelCandidate[] {
  const lineGap = estimateLineGap(p, gaps) ?? 4 * p.rowsPerPx;
  // Typical text line height: median of the ink runs short enough to be single lines.
  const maxLine = 48 * p.rowsPerPx;
  const lineRuns: number[] = [];
  for (let i = 1; i < gaps.length; i++) {
    const run = gaps[i]!.r0 - gaps[i - 1]!.r1;
    if (run <= maxLine) lineRuns.push(run);
  }
  const typicalLine = lineRuns.length ? median(lineRuns) : 0;
  const out: PixelCandidate[] = [];
  for (let gi = 0; gi < gaps.length; gi++) {
    const g = gaps[gi]!;
    if (g.r0 === 0 || g.r1 === p.height) continue; // page top/bottom margins are not breaks
    const h = g.r1 - g.r0;
    let kind: PixelKind;
    let badness: number;
    // Inside a ruled structure, a gap next to or containing a horizontal rule (a row of a
    // clearly different colour) separates table rows. The rule row itself often counts as
    // ink (the page margin beside the table differs from it), so it bounds the gap.
    let ruled = false;
    if (g.rule) {
      const inside = p.mode[(g.r0 + g.r1) >> 1]!;
      const differs = (r: number) => Math.abs(p.mode[r]! - inside) > 24;
      ruled = differs(g.r0 - 1) || differs(g.r1);
      for (let r = g.r0; r < g.r1 && !ruled; r++) ruled = differs(r);
    }
    if (ruled) {
      kind = 'tableRow';
      badness = 2.5;
    } else if (h >= 3 * lineGap) {
      kind = 'section';
      badness = 0.5;
    } else if (h >= 1.5 * lineGap) {
      kind = 'paragraph';
      badness = 1.5;
    } else {
      kind = 'line';
      badness = 4;
    }
    // Without the DOM: a single line that starts a block (more space above it than below)
    // would be stranded by a cut right under it — an orphan, or, when the line is taller
    // than body text, a heading cut off from its content.
    const prevGap = gaps[gi - 1];
    if (prevGap) {
      const run = g.r0 - prevGap.r1;
      const startsBlock = prevGap.r1 - prevGap.r0 > 1.2 * h || prevGap.r0 === 0;
      if (startsBlock && run <= maxLine) {
        badness += typicalLine > 0 && run >= 1.3 * typicalLine ? HEADING_ABOVE : ORPHAN;
      }
    }
    out.push({
      y: (g.r0 + g.r1) / 2 / p.rowsPerPx,
      kind,
      badness,
      y0: g.r0 / p.rowsPerPx,
      y1: g.r1 / p.rowsPerPx,
    });
  }
  return out;
}

/** Is the row at CSS y safe to cut? */
export function isSafeAt(p: RowProfile, y: Px): boolean {
  const r = Math.round(y * p.rowsPerPx);
  if (r <= 0 || r >= p.height) return true;
  // A cut at a row boundary needs the rows on both sides of it clean.
  return p.safe[r]! > 0 || p.safe[r - 1]! > 0;
}

/** Nearest safe CSS y within ±radius, or null. Ties go to the smaller y (deterministic). */
export function nearestSafe(p: RowProfile, y: Px, radius: Px): Px | null {
  const r = Math.round(y * p.rowsPerPx);
  const rr = Math.ceil(radius * p.rowsPerPx);
  for (let d = 0; d <= rr; d++) {
    for (const c of [r - d, r + d]) {
      if (c >= 0 && c < p.height && p.safe[c]) return c / p.rowsPerPx;
    }
  }
  return null;
}

/** PAGINATION §4: the row in [y0, y1] whose cut splits the fewest edges. */
export function leastDamage(p: RowProfile, y0: Px, y1: Px): Px {
  const a = Math.max(1, Math.round(y0 * p.rowsPerPx));
  const b = Math.min(p.height - 1, Math.round(y1 * p.rowsPerPx));
  let best = a;
  for (let r = a; r <= b; r++) if (p.damage[r]! < p.damage[best]!) best = r;
  return best / p.rowsPerPx;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
