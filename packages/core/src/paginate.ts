import { mergeIntervals, type Interval, type Px } from './geometry.js';
import type { BoundaryKind, DomHints } from './hints.js';
import {
  findGaps,
  isSafeAt,
  leastDamage,
  nearestSafe,
  pixelCandidates,
  type RowProfile,
} from './rows.js';

export type BreakKind = BoundaryKind | 'pixel' | 'forced' | 'manual' | 'end';

/** PAGINATION §8. Document coordinates, region-relative CSS px. */
export interface PageSlice {
  y0: Px;
  y1: Px;
  x0: Px;
  x1: Px;
  /** Content repeated from the previous page after a forced cut. */
  overlapTop: Px;
  breakKind: BreakKind;
  cost: number;
  warnings: string[];
}

export interface PaginateOptions {
  /** Weight of page fill (pack pages fully). */
  alpha: number;
  /** Weight of break badness (prefer clean breaks). */
  beta: number;
  /** Breaks the user pinned: always used. */
  pinned: Px[];
  /** Breaks the user removed: never used (±3 px). */
  removed: Px[];
  /** Repeated content after a forced cut; 'auto' = max(24, 1.5 × line height). */
  overlap: Px | 'auto';
}

export const DEFAULT_PAGINATE_OPTIONS: PaginateOptions = {
  alpha: 1,
  beta: 1,
  pinned: [],
  removed: [],
  overlap: 'auto',
};

export interface PaginateInput {
  /** Region height H and width, CSS px. */
  height: Px;
  width: Px;
  /** Target slice height, CSS px (layout.T). */
  T: Px;
  hints?: DomHints | null;
  rows?: RowProfile | null;
  /** Horizontal crop; defaults to the full width. */
  crop?: { x0: Px; x1: Px };
  options?: Partial<PaginateOptions>;
}

/** "Fewer pages ↔ cleaner breaks" slider (0…1) → α/β; 0.5 gives α = β = 1. */
export function sliderWeights(t: number): { alpha: number; beta: number } {
  const c = Math.min(1, Math.max(0, t));
  return { alpha: 2 ** ((0.5 - c) * 2), beta: 2 ** ((c - 0.5) * 2) };
}

/** Badness of cutting at a DOM boundary of each kind (PAGINATION §2). */
const BOUNDARY_BADNESS: Record<BoundaryKind, number> = {
  section: 0,
  paragraph: 1,
  listItem: 1.5,
  tableRow: 2.5,
  line: 4,
};
const EMPTY_SPACE_BADNESS = 3;
const KEEP_WITH_NEXT = 40;
const WIDOW_ORPHAN = 6;
const PIXEL_UNCONFIRMED = 20;
const INSIDE_SHORT_OPAQUE = 8;
const FORCED_BASE = 100;
const FALLBACK_BASE = 200;
const SHORT_PAGE = 50;
const MIN_FILL = 0.35;
/** Forbidden runs taller than this share of T must be split (PAGINATION §5). */
const TALL = 0.9;
const FORCED_STEP = 8;
const GAP_SAMPLE = 32;

interface Cand {
  y: Px;
  b: number;
  kind: BreakKind;
  forced: boolean;
  pinned: boolean;
  /** No clean break found nearby (fallback cut through anything). */
  fallback: boolean;
  /** DOM break the pixels could not confirm. */
  unconfirmed: boolean;
}

/**
 * PAGINATION §2–5: choose page breaks so no page exceeds T, text is never cut except where
 * an element is taller than a page, and breaks fall on the cleanest boundaries.
 * Deterministic: the same input gives the same slices.
 */
export function paginate(input: PaginateInput): PageSlice[] {
  return paginateDebug(input).slices;
}

/** What pagination considered, for the debug overlay (PAGINATION §9). */
export interface PaginationDebug {
  slices: PageSlice[];
  candidates: Array<{ y: Px; badness: number; kind: BreakKind; forced: boolean }>;
  forbidden: Interval[];
  opaque: Interval[];
}

export function paginateDebug(input: PaginateInput): PaginationDebug {
  const opts = { ...DEFAULT_PAGINATE_OPTIONS, ...input.options };
  const H = input.height;
  const T = input.T;
  const crop = input.crop ?? { x0: 0, x1: input.width };
  if (!(T > 0) || !(H > 0)) throw new Error('paginate: height and T must be positive');

  const overlap = Math.min(0.25 * T, opts.overlap === 'auto' ? autoOverlap(input) : opts.overlap);
  const pinned = [...new Set(opts.pinned.filter((y) => y > 0 && y < H))].sort((a, b) => a - b);

  const { forbidden, opaque } = regions(input.hints ?? null, T);
  if (H <= T && pinned.length === 0) {
    return { slices: [slice(0, H, crop, 0, 'end', 0, [])], candidates: [], forbidden, opaque };
  }

  const base = buildCandidates(input, T);
  let cands = applyEdits(base, pinned, opts.removed, H);
  let breaks = solve(cands, T, overlap, opts.alpha, opts.beta);
  if (!breaks) {
    // Some stretch has no usable candidate (pinned breaks too far apart, no hints and no
    // pixels...). Add last-resort cuts everywhere; they carry an overlap and a warning.
    const extra: Cand[] = [];
    for (let y = FORCED_STEP; y < H; y += FORCED_STEP) {
      extra.push({
        y,
        b: FALLBACK_BASE,
        kind: 'forced',
        forced: true,
        pinned: false,
        fallback: true,
        unconfirmed: false,
      });
    }
    cands = applyEdits(dedupe([...base, ...extra]), pinned, opts.removed, H);
    breaks = solve(cands, T, overlap, opts.alpha, opts.beta);
    if (!breaks) throw new Error('paginate: no feasible page breaks');
  }

  const slices: PageSlice[] = [];
  for (let k = 1; k < breaks.length; k++) {
    const from = breaks[k - 1]!;
    const to = breaks[k]!;
    const ov = from.c.forced ? overlap : 0;
    const page = k;
    const warnings: string[] = [];
    if (to.c.forced && to.c.fallback) {
      warnings.push(
        `Page ${page}: no clean break was found; the cut repeats a strip on the next page.`,
      );
    } else if (to.c.forced) {
      warnings.push(`Page ${page}: an element taller than one page was split.`);
    } else if (to.c.unconfirmed) {
      warnings.push(`Page ${page}: the break could not be confirmed against the image.`);
    }
    const kind: BreakKind = k === breaks.length - 1 ? 'end' : to.c.pinned ? 'manual' : to.c.kind;
    slices.push(slice(from.c.y - ov, to.c.y, crop, ov, kind, to.cost, warnings));
  }
  return {
    slices,
    candidates: cands
      .filter((c) => c.y > 0 && c.y < H && !c.fallback)
      .map((c) => ({ y: c.y, badness: c.b, kind: c.kind, forced: c.forced })),
    forbidden,
    opaque,
  };
}

/** Forbidden runs and opaque regions; images taller than half a page count as opaque. */
function regions(hints: DomHints | null, T: Px): { forbidden: Interval[]; opaque: Interval[] } {
  const bigImage = (f: { kind: string; y0: number; y1: number }) =>
    f.kind === 'image' && f.y1 - f.y0 > 0.5 * T;
  return {
    opaque: mergeIntervals([
      ...(hints?.opaque ?? []).map((r) => ({ y0: r.y, y1: r.y + r.height })),
      ...(hints?.forbidden ?? []).filter(bigImage),
    ]),
    forbidden: mergeIntervals((hints?.forbidden ?? []).filter((f) => !bigImage(f))),
  };
}

function slice(
  y0: Px,
  y1: Px,
  crop: { x0: Px; x1: Px },
  overlapTop: Px,
  breakKind: BreakKind,
  cost: number,
  warnings: string[],
): PageSlice {
  return { y0, y1, x0: crop.x0, x1: crop.x1, overlapTop, breakKind, cost, warnings };
}

function autoOverlap(input: PaginateInput): Px {
  const lines = (input.hints?.forbidden ?? [])
    .filter((f) => f.kind === 'line')
    .map((f) => f.y1 - f.y0);
  if (lines.length) {
    lines.sort((a, b) => a - b);
    return Math.max(24, 1.5 * lines[lines.length >> 1]!);
  }
  return 24;
}

function buildCandidates(input: PaginateInput, T: Px): Cand[] {
  const H = input.height;
  const { hints, rows } = input;
  const out: Cand[] = [];
  const add = (c: Partial<Cand> & { y: Px; b: number; kind: BreakKind }) => {
    if (c.y > 0 && c.y < H) {
      out.push({ forced: false, pinned: false, fallback: false, unconfirmed: false, ...c });
    }
  };

  // Images taller than half a page are probably pictures of text: let pixels decide.
  const { forbidden, opaque } = regions(hints ?? null, T);
  const inside = (y: Px, list: readonly Interval[]) => list.some((iv) => y > iv.y0 && y < iv.y1);
  const opaqueAt = (y: Px) => opaque.find((iv) => y > iv.y0 && y < iv.y1);

  const pixel = rows ? pixelCandidates(rows, findGaps(rows)) : [];

  if (hints) {
    // DOM candidates: positions in the gaps between forbidden runs.
    const boundaries = [...hints.blockEnds].sort((a, b) => a.y - b.y);
    const blockLevel = boundaries.filter((b) => b.kind !== 'line').map((b) => b.y);
    const lineCenters = (hints.forbidden ?? [])
      .filter((f) => f.kind === 'line')
      .map((f) => (f.y0 + f.y1) / 2)
      .sort((a, b) => a - b);
    let prevEnd = 0;
    for (const iv of [...forbidden, { y0: H, y1: H }]) {
      const a = prevEnd;
      const b = Math.min(iv.y0, H);
      prevEnd = Math.max(prevEnd, iv.y1);
      if (b <= a) continue;
      let bad = EMPTY_SPACE_BADNESS;
      let kind: BreakKind = 'line';
      for (const bd of boundaries) {
        if (bd.y < a - 2 || bd.y > b + 2) continue;
        const v = BOUNDARY_BADNESS[bd.kind];
        if (v < bad || (v === bad && kind === 'line')) {
          bad = v;
          kind = bd.kind;
        }
      }
      const ys = [(a + b) / 2];
      if (b - a > 2 * GAP_SAMPLE)
        for (let y = a + GAP_SAMPLE / 2; y < b - GAP_SAMPLE / 2; y += GAP_SAMPLE) ys.push(y);
      for (let y of ys) {
        if (opaqueAt(y)) continue; // pixels decide inside opaque regions
        let b2 = bad;
        let unconfirmed = false;
        if (rows && !isSafeAt(rows, y)) {
          const moved = nearestSafe(rows, y, 4);
          if (moved !== null && !inside(moved, forbidden)) y = moved;
          else {
            b2 += PIXEL_UNCONFIRMED;
            unconfirmed = true;
          }
        }
        if (inside(y, hints.keepWithNext)) b2 += KEEP_WITH_NEXT;
        if (kind === 'line' && widowOrOrphan(y, blockLevel, lineCenters)) b2 += WIDOW_ORPHAN;
        add({ y, b: b2, kind, unconfirmed });
      }
    }
    // Inside opaque regions (canvas, iframes, pictures of text): pixel gaps that don't
    // cross any DOM-forbidden run.
    for (const pc of pixel) {
      const iv = opaqueAt(pc.y);
      if (!iv || inside(pc.y, forbidden)) continue;
      const short = iv.y1 - iv.y0 <= TALL * T;
      add({ y: pc.y, b: pc.badness + (short ? INSIDE_SHORT_OPAQUE : 0), kind: pc.kind });
    }
  } else {
    // No DOM (imported images and PDFs): pixel gaps only.
    for (const pc of pixel) add({ y: pc.y, b: pc.badness, kind: pc.kind });
  }

  // Runs taller than a page must be split (PAGINATION §5): pixel gaps inside them if any
  // (code blocks have line gaps), else forced cuts at the least damaging rows.
  const tall = mergeIntervals([...forbidden, ...opaque]).filter((iv) => iv.y1 - iv.y0 > TALL * T);
  for (const iv of tall) {
    if (hints) {
      for (const pc of pixel) {
        if (pc.y > iv.y0 && pc.y < iv.y1 && !opaqueAt(pc.y))
          add({ y: pc.y, b: pc.badness + 2, kind: pc.kind });
      }
    }
    for (let y = iv.y0 + FORCED_STEP; y < iv.y1; y += FORCED_STEP) {
      let fy = y;
      let damage = 0;
      if (rows) {
        fy = leastDamage(rows, y - FORCED_STEP / 2, y + FORCED_STEP / 2);
        damage = rows.damage[Math.round(fy * rows.rowsPerPx)]! / Math.max(1, rows.width);
      }
      add({ y: fy, b: FORCED_BASE + 20 * damage, kind: 'forced', forced: true });
    }
  }
  return dedupe(out);
}

/** A line-level cut leaving fewer than 2 lines of a block on either side. */
function widowOrOrphan(y: Px, blockLevel: readonly Px[], lineCenters: readonly Px[]): boolean {
  let above = 0;
  let below = Infinity;
  for (const b of blockLevel) {
    if (b <= y) above = b;
    else {
      below = b;
      break;
    }
  }
  let before = 0;
  let after = 0;
  for (const c of lineCenters) {
    if (c > above && c < y) before++;
    else if (c > y && c < below) after++;
  }
  return before < 2 || after < 2;
}

function dedupe(cands: Cand[]): Cand[] {
  const sorted = [...cands].sort((a, b) => a.y - b.y || a.b - b.b);
  const out: Cand[] = [];
  for (const c of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(last.y - c.y) < 0.5) {
      if (c.b < last.b) out[out.length - 1] = c;
    } else out.push(c);
  }
  return out;
}

function applyEdits(cands: Cand[], pinned: readonly Px[], removed: readonly Px[], H: Px): Cand[] {
  const kept = cands.filter(
    (c) =>
      !removed.some((r) => Math.abs(r - c.y) <= 3) && !pinned.some((p) => Math.abs(p - c.y) < 0.5),
  );
  for (const y of pinned) {
    kept.push({
      y,
      b: 0,
      kind: 'manual',
      forced: false,
      pinned: true,
      fallback: false,
      unconfirmed: false,
    });
  }
  kept.push({
    y: 0,
    b: 0,
    kind: 'end',
    forced: false,
    pinned: true,
    fallback: false,
    unconfirmed: false,
  });
  kept.push({
    y: H,
    b: 0,
    kind: 'end',
    forced: false,
    pinned: true,
    fallback: false,
    unconfirmed: false,
  });
  return kept.sort((a, b) => a.y - b.y);
}

/** Knuth–Plass style DP over candidates (PAGINATION §3). Returns the chosen breaks or null. */
function solve(
  cands: Cand[],
  T: Px,
  overlap: Px,
  alpha: number,
  beta: number,
): Array<{ c: Cand; cost: number }> | null {
  const n = cands.length;
  const dp = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const edge = new Float64Array(n);
  dp[0] = 0;
  let lastPinned = 0; // breaks may not skip a pinned candidate
  let lo = 0;
  for (let j = 1; j < n; j++) {
    const cj = cands[j]!;
    while (cands[lo]!.y < cj.y - T) lo++;
    const isLast = j === n - 1;
    for (let i = Math.max(lo, lastPinned); i < j; i++) {
      if (dp[i] === Infinity) continue;
      const ci = cands[i]!;
      const h = cj.y - ci.y + (ci.forced ? overlap : 0);
      if (h > T + 1e-6 || cj.y - ci.y <= 0) continue;
      const fill = isLast ? 0 : ((T - h) / T) ** 2 * 100;
      const short = !isLast && h < MIN_FILL * T ? SHORT_PAGE : 0;
      const step = alpha * fill + beta * cj.b + short;
      const total = dp[i]! + step;
      if (total < dp[j]!) {
        dp[j] = total;
        from[j] = i;
        edge[j] = step;
      }
    }
    if (cj.pinned) lastPinned = j;
    if (cj.pinned && dp[j] === Infinity) return null;
  }
  if (dp[n - 1] === Infinity) return null;
  const path: Array<{ c: Cand; cost: number }> = [];
  for (let j = n - 1; j >= 0; j = from[j]!) {
    path.push({ c: cands[j]!, cost: edge[j]! });
    if (j === 0) break;
  }
  return path.reverse();
}
