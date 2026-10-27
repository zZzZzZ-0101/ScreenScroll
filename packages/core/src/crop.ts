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
  let lo = Infinity;
  let hi = -Infinity;
  const { rows, hints } = sources;
  if (rows) {
    // Columns need ink in a few rows, so stray anti-aliasing doesn't widen the crop.
    const minRows = Math.max(1, Math.floor(rows.height * 0.001));
    const scale = width / rows.width;
    for (let x = 0; x < rows.width; x++) {
      if (rows.colInk[x]! >= minRows) {
        lo = Math.min(lo, x * scale);
        hi = Math.max(hi, (x + 1) * scale);
      }
    }
  }
  for (const r of [...(hints?.textRuns ?? []).map((t) => t.rect), ...(hints?.opaque ?? [])]) {
    lo = Math.min(lo, r.x);
    hi = Math.max(hi, r.x + r.width);
  }
  if (!Number.isFinite(lo)) return { x0: 0, x1: width, cropped: false };
  const x0 = Math.max(0, lo - CROP_PAD);
  const x1 = Math.min(width, hi + CROP_PAD);
  if (width - (x1 - x0) < CROP_MIN_MARGIN * width) return { x0: 0, x1: width, cropped: false };
  return { x0, x1, cropped: true };
}
