import { debugJson, drawDebugOverlay, type PaginationDebug } from '@screenscroll/core';
import type { Analysis } from '@/studio/engine/analysis';
import { drawFromStrip } from './strip';

/** PAGINATION §9: the long thumbnail with the break overlay as PNG, plus the slices as JSON. */
export async function exportDebugOverlay(
  a: Analysis,
  d: PaginationDebug,
  width: number,
): Promise<{ png: Blob; json: string }> {
  const height = a.strip.at(-1)!.y1;
  // Thumbnail scale (≤ 320 px wide), reduced further so very long captures stay under the
  // browser's canvas height limit.
  const scale = Math.min(a.stripScale, 30_000 / height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * scale));
  c.height = Math.max(1, Math.round(height * scale));
  const ctx = c.getContext('2d')!;
  drawFromStrip(ctx, a, { x0: 0, x1: width, y0: 0, y1: height }, c.width);
  drawDebugOverlay(ctx, d, c.width, c.width / width);
  const png = await new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the overlay.'))),
      'image/png',
    ),
  );
  return { png, json: debugJson(d) };
}
