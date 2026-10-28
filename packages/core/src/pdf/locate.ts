import type { Px } from '../geometry.js';
import type { PageLayout } from '../layout.js';
import type { PageSlice } from '../paginate.js';

/** The page showing document y (first appearance, ignoring repeated overlap), and its pt top. */
export function locate(
  slices: readonly PageSlice[],
  layout: PageLayout,
  y: Px,
): { page: number; top: number } | null {
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]!;
    const last = i === slices.length - 1;
    if (y >= s.y0 + s.overlapTop && (y < s.y1 || (last && y <= s.y1))) {
      return { page: i, top: layout.paperH - (layout.box.y + (y - s.y0) * layout.s) };
    }
  }
  return null;
}
