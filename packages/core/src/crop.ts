import type { Px } from './geometry.js';
import type { DomHints } from './hints.js';
import type { RowProfile } from './rows.js';

export const CROP_PAD = 12;
/** Crop only when the empty side margins together take at least this share of the width. */
export const CROP_MIN_MARGIN = 0.15;

/**
 * PAGINATION §6: horizontal crop to the content columns. Ink comes from the pixels (any
 * column off its row's dominant colour) and, when present, DOM text and links. Sidebars
 * with content count as ink, so they are kept.
 */
export function contentCrop(
  width: Px,
  sources: { rows?: RowProfile | null; hints?: DomHints | null },
): { x0: Px; x1: Px; cropped: boolean } {
  const { rows, hints } = sources;
  // Ink per column: rows with off-colour pixels, plus the height of DOM text and images
  // over it. Weighed, not "any ink": a full-width top bar (logo left, icons right) has a
  // little ink at both edges and must not stop the crop of a centred page.
  const n = rows ? rows.width : Math.max(1, Math.ceil(width));
  const scale = width / n;
  const ink = new Float64Array(n);
  if (rows) {
    // Columns need ink in a few rows, so stray anti-aliasing doesn't count.
    const minRows = Math.max(1, Math.floor(rows.height * 0.001));
    for (let x = 0; x < n; x++) if (rows.colInk[x]! >= minRows) ink[x] = rows.colInk[x]!;
  }
  for (const r of [...(hints?.textRuns ?? []).map((t) => t.rect), ...(hints?.opaque ?? [])]) {
    const a = Math.max(0, Math.floor(r.x / scale));
    const b = Math.min(n, Math.ceil((r.x + r.width) / scale));
    for (let x = a; x < b; x++) ink[x]! += r.height * (rows ? rows.rowsPerPx : 1);
  }
  let total = 0;
  for (const v of ink) total += v;
  let lo = Infinity;
  let hi = -Infinity;
  if (total > 0) {
    // Leave out at most 1% of the ink on each side: sparse edge furniture, not content.
    const skip = 0.01 * total;
    let a = 0;
    for (let acc = 0; a < n && acc + ink[a]! <= skip; a++) acc += ink[a]!;
    let b = n - 1;
    for (let acc = 0; b > a && acc + ink[b]! <= skip; b--) acc += ink[b]!;
    while (a < b && ink[a] === 0) a++;
    while (b > a && ink[b] === 0) b--;
    // Grow back over neighbouring columns with real content (≥ 5% of a typical core
    // column), so the trim never shaves the content itself.
    const core = [...ink.subarray(a, b + 1)].filter((v) => v > 0).sort((p, q) => p - q);
    const enough = 0.05 * (core[core.length >> 1] ?? 0);
    while (a > 0 && ink[a - 1]! > 0 && ink[a - 1]! >= enough) a--;
    while (b < n - 1 && ink[b + 1]! > 0 && ink[b + 1]! >= enough) b++;
    lo = a * scale;
    hi = (b + 1) * scale;
  }
  if (!Number.isFinite(lo)) return { x0: 0, x1: width, cropped: false };
  const x0 = Math.max(0, lo - CROP_PAD);
  const x1 = Math.min(width, hi + CROP_PAD);
  if (width - (x1 - x0) < CROP_MIN_MARGIN * width) return { x0: 0, x1: width, cropped: false };
  return { x0, x1, cropped: true };
}
