import type { Analysis } from '@/studio/engine/analysis';

/**
 * Draws a document region from the long thumbnail strip, scaled to `outW` px wide.
 * Previews use the strip so they never decode full frames.
 */
export function drawFromStrip(
  ctx: CanvasRenderingContext2D,
  a: Analysis,
  region: { x0: number; x1: number; y0: number; y1: number },
  outW: number,
  dy0 = 0,
): void {
  const k = outW / (region.x1 - region.x0); // output px per CSS px
  for (const part of a.strip) {
    const top = Math.max(region.y0, part.y0);
    const bottom = Math.min(region.y1, part.y1);
    if (bottom <= top) continue;
    ctx.drawImage(
      part.canvas,
      region.x0 * a.stripScale,
      (top - part.y0) * a.stripScale,
      (region.x1 - region.x0) * a.stripScale,
      (bottom - top) * a.stripScale,
      0,
      dy0 + (top - region.y0) * k,
      outW,
      (bottom - top) * k,
    );
  }
}
