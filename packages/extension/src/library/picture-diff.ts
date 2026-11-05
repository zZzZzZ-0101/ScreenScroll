import {
  BlockPrinter,
  diffPictures,
  ownedBands,
  toGrey,
  type PictureBlock,
  type PictureChange,
} from '@screenscroll/core';
import { composePage } from '@/studio/engine/compose';
import { FrameCache, loadSession, type LoadedSession } from '@/studio/engine/session';

/** Fingerprint width: enough to see a changed word, small enough to be quick on long pages. */
const PRINT_WIDTH = 480;
/** Shown crops: at most this many image px wide (two per row, sharp on 2× screens) and
 * this many CSS px tall each; the changed columns only, so text stays readable. */
const CROP_WIDTH = 680;
const CROP_MAX = 900;
const MAX_SHOWN = 12;

export interface PictureCrop {
  url: string;
  y0: number;
  y1: number;
  /** The change ran on below what is shown. */
  clipped: boolean;
}

export interface PictureDiff {
  /** Null when the captures can't be compared row for row (different widths). */
  changes: PictureChange[] | null;
  widths: [number, number];
  shown: Array<{ before: PictureCrop | null; after: PictureCrop | null }>;
}

/**
 * Streams one frame at a time (CLAUDE.md rule 5): each frame's own rows go to the printer
 * at fingerprint width; no canvas is taller than a frame.
 */
async function blocksOf(s: LoadedSession, frames: FrameCache): Promise<PictureBlock[]> {
  const w = Math.min(PRINT_WIDTH, Math.round(s.width));
  const printer = new BlockPrinter(w);
  const bands = ownedBands(s.geoms);
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    const h = Math.round(band.y1 - band.y0);
    if (h <= 0) continue;
    const g = s.geoms[i]!;
    const bitmap = await frames.get(i);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, g.cropX, g.cropY + (band.y0 - g.docY) * g.dpr, s.width * g.dpr, h * g.dpr, 0, 0, w, h);
    printer.push(toGrey({ width: w, height: h, data: ctx.getImageData(0, 0, w, h).data, channels: 4 }));
  }
  return printer.finish();
}

async function crop(
  s: LoadedSession,
  frames: FrameCache,
  iv: { y0: number; y1: number } | null,
  cols: { x0: number; x1: number },
): Promise<PictureCrop | null> {
  if (!iv) return null;
  // Printer columns → CSS px of this capture, with a little room either side.
  const k = s.width / Math.min(PRINT_WIDTH, Math.round(s.width));
  const x0 = Math.max(0, cols.x0 * k - 16);
  const x1 = Math.min(s.width, cols.x1 * k + 16);
  const y0 = Math.max(0, iv.y0 - 8);
  const end = Math.min(s.height, iv.y1 + 8);
  const y1 = Math.min(end, y0 + CROP_MAX);
  const canvas = await composePage(
    s,
    frames,
    { x0, x1, y0, y1 },
    Math.min(1, CROP_WIDTH / ((x1 - x0) * s.dpr)),
  );
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { url: URL.createObjectURL(blob), y0: iv.y0, y1: Math.min(iv.y1, s.height), clipped: y1 < end };
}

export async function comparePictures(olderId: string, newerId: string): Promise<PictureDiff> {
  const [a, b] = await Promise.all([loadSession(olderId), loadSession(newerId)]);
  const widths: [number, number] = [Math.round(a.width), Math.round(b.width)];
  if (Math.abs(a.width - b.width) > 1) return { changes: null, widths, shown: [] };
  const fa = new FrameCache(a.frames, 2);
  const fb = new FrameCache(b.frames, 2);
  const changes = diffPictures(await blocksOf(a, fa), await blocksOf(b, fb));
  const shown: PictureDiff['shown'] = [];
  for (const c of changes.slice(0, MAX_SHOWN))
    shown.push({ before: await crop(a, fa, c.removed, c), after: await crop(b, fb, c.added, c) });
  fa.clear();
  fb.clear();
  return { changes, widths, shown };
}
