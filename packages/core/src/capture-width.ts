/**
 * "Capture at width W" (CAPTURE §8): a wide page scaled onto A4 shrinks its text, so the
 * window is made narrower for the capture and the layout reflows to W CSS px.
 */

/** Off, or the widest the page may be laid out at, CSS px. */
export const CAPTURE_WIDTHS = [0, 1000, 1200, 1440] as const;
export type CaptureWidth = (typeof CAPTURE_WIDTHS)[number];

/** Browsers refuse windows narrower than about this (outer px). */
export const MIN_WINDOW_WIDTH = 500;

/**
 * The window width that lays the page out at `target` CSS px, or null when nothing should
 * change: the setting is off, or the page is already that narrow (the window is never made
 * wider than the user has it). The window's chrome (frame, scrollbar) keeps its width, so
 * the window shrinks by exactly what the page must lose; `zoom` turns CSS px into window px.
 */
export function narrowWindowTo(
  target: number,
  window: { width: number },
  viewportCss: number,
  zoom = 1,
): number | null {
  if (!target || viewportCss <= target + 1) return null;
  const width = Math.round(window.width - (viewportCss - target) * zoom);
  return Math.max(MIN_WINDOW_WIDTH, width);
}
