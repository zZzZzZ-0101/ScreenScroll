import { composeOps, type PageSlice } from '@scrollpress/core';
import { chooseImageFormat, type PageImage } from '@scrollpress/core/pdf';
import type { FrameCache, LoadedSession } from './session';

/**
 * PDF_OUTPUT §1: one page image from the frames that intersect the slice. The canvas is
 * the slice's size (≤ one page plus overlap), never the whole capture.
 */
export async function composePage(
  s: LoadedSession,
  frames: FrameCache,
  region: { x0: number; x1: number; y0: number; y1: number },
  scale = 1,
): Promise<OffscreenCanvas> {
  const outDpr = s.dpr * scale;
  const w = Math.max(1, Math.round((region.x1 - region.x0) * outDpr));
  const h = Math.max(1, Math.round((region.y1 - region.y0) * outDpr));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  for (const op of composeOps(s.geoms, region, outDpr)) {
    const bitmap = await frames.get(op.frame);
    ctx.drawImage(bitmap, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
  }
  return canvas;
}

export type ImageMode = 'auto' | 'png' | 'jpeg';

/** Encodes a composed page, picking PNG or JPEG 90 by content when `mode` is auto. */
export async function encodePage(
  canvas: OffscreenCanvas,
  slice: PageSlice,
  mode: ImageMode = 'auto',
): Promise<PageImage> {
  let format: 'png' | 'jpeg' = mode === 'jpeg' ? 'jpeg' : 'png';
  if (mode === 'auto') {
    // Decide on a small copy: counting colours on the full page would cost more than it saves.
    const probe = new OffscreenCanvas(
      200,
      Math.max(1, Math.round((200 * canvas.height) / canvas.width)),
    );
    const pctx = probe.getContext('2d', { willReadFrequently: true })!;
    pctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    format = chooseImageFormat(pctx.getImageData(0, 0, probe.width, probe.height).data);
  }
  const blob = await canvas.convertToBlob(
    format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 },
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), format, slice };
}
