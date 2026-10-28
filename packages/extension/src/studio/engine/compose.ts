import {
  applyFilter,
  composeOps,
  drawAnnotations,
  type Annotation,
  type AnnotationCtx,
  type FilterId,
  type PageSlice,
} from '@screenscroll/core';
import { chooseImageFormat, type PageImage } from '@screenscroll/core/pdf';
import type { ImageMode } from '@/shared/settings';
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
  annotations: readonly Annotation[] = [],
  filter: FilterId = 'original',
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
  // The filter acts on the page, then mark-up goes on top in its own colours.
  filterCanvas(ctx, filter, outDpr);
  paintAnnotations(ctx, annotations, region, outDpr);
  return canvas;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Applies a page filter to the whole canvas; `pxPerCss` sizes its neighbourhoods. */
export function filterCanvas(ctx: Ctx, filter: FilterId, pxPerCss: number): void {
  if (filter === 'original') return;
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, height);
  applyFilter(filter, img, pxPerCss);
  ctx.putImageData(img, 0, 0);
}

/**
 * Draws annotations over a canvas that already shows `region` at `scale` px per CSS px
 * (page images at export, previews in the Studio). Blur and pixelate work on the pixels.
 */
export function paintAnnotations(
  ctx: Ctx,
  annotations: readonly Annotation[],
  region: { x0: number; x1: number; y0: number; y1: number },
  scale: number,
): void {
  if (!annotations.length) return;
  const canvas = ctx.canvas;
  drawAnnotations(ctx as unknown as AnnotationCtx, annotations, region, scale, {
    blur(x, y, w, h) {
      // Strong enough that text underneath can't be read back.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(4, 12 * scale)}px)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.drawImage(canvas, 0, 0); // twice: one pass leaves large text legible
      ctx.restore();
    },
    pixelate(x, y, w, h) {
      const block = Math.max(3, 10 * scale);
      const tw = Math.max(1, Math.ceil(w / block));
      const th = Math.max(1, Math.ceil(h / block));
      const small = new OffscreenCanvas(tw, th);
      const sctx = small.getContext('2d')!;
      sctx.drawImage(canvas, x, y, w, h, 0, 0, tw, th);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, tw, th, x, y, w, h);
      ctx.restore();
    },
  });
}

export type { ImageMode } from '@/shared/settings';

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
