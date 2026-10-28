import type { Px, Rect } from './geometry.js';

/**
 * A region of the scroll target's content (CAPTURE §14 selection / element modes), in content
 * coordinates: y = viewport y + scroll offset − the target's top; x as in the viewport.
 */
export interface Region {
  x0: Px;
  x1: Px;
  y0: Px;
  y1: Px;
}

/** What one frame contributes to a region capture. */
export interface RegionFrame {
  /** Crop rect in viewport CSS px. */
  crop: Rect;
  /** Region-relative y of the crop's top. */
  docY: Px;
  /** Content y the region is covered to after this frame. */
  coveredTo: Px;
}

/**
 * The part of `region` visible at scroll `offset`, not already covered by earlier frames.
 * `viewport` is the scroll target's visible box (viewport CSS px). Null when the frame adds
 * nothing (it shows only rows already covered, or none of the region).
 */
export function regionFrame(
  region: Region,
  viewport: Rect,
  offset: Px,
  coveredTo: Px,
): RegionFrame | null {
  const top = Math.max(region.y0, coveredTo, offset);
  const bottom = Math.min(region.y1, offset + viewport.height);
  const left = Math.max(region.x0, viewport.x);
  const right = Math.min(region.x1, viewport.x + viewport.width);
  if (bottom - top < 0.5 || right - left < 0.5) return null;
  return {
    crop: { x: left, y: viewport.y + (top - offset), width: right - left, height: bottom - top },
    docY: top - region.y0,
    coveredTo: bottom,
  };
}

/** Where to scroll next so the uncovered rest of the region starts at the top of the view. */
export function regionScroll(coveredTo: Px, maxScroll: Px): Px {
  return Math.max(0, Math.min(coveredTo, maxScroll));
}

/** Clamps a drawn rectangle (any corner order) to the content box. */
export function normalizeRegion(
  a: { x: Px; y: Px },
  b: { x: Px; y: Px },
  width: Px,
  height: Px,
): Region {
  return {
    x0: Math.max(0, Math.min(a.x, b.x)),
    x1: Math.min(width, Math.max(a.x, b.x)),
    y0: Math.max(0, Math.min(a.y, b.y)),
    y1: Math.min(height, Math.max(a.y, b.y)),
  };
}
