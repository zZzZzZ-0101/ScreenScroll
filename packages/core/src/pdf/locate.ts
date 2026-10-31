import type { Px } from '../geometry.js';
import type { PageLayout } from '../layout.js';
import { repeatHeight, type PageSlice } from '../paginate.js';

/**
 * The layout a page's own content is placed with: below a repeated table header the box
 * starts lower by the header's height, so text, links and jumps line up with the image.
 */
export function contentLayout(layout: PageLayout, slice: Pick<PageSlice, 'repeat'>): PageLayout {
  const h = repeatHeight(slice);
  return h ? { ...layout, box: { ...layout.box, y: layout.box.y + h * layout.s } } : layout;
}

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
      const l = contentLayout(layout, s);
      return { page: i, top: l.paperH - (l.box.y + (y - s.y0) * l.s) };
    }
  }
  return null;
}
