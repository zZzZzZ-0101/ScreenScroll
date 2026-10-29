import {
  detectSheets,
  ownedBands,
  RowAnalyzer,
  SheetAnalyzer,
  toGrey,
  type RowProfile,
  type SheetLayout,
} from '@screenscroll/core';
import type { FrameCache, LoadedSession } from './session';

export const ANALYSIS_WIDTH = 800;
export const STRIP_WIDTH = 320;

export interface Analysis {
  rows: RowProfile;
  /** Long-view thumbnail: one small canvas per frame band, stacked (ARCHITECTURE: ≤ 320 px). */
  strip: Array<{ canvas: HTMLCanvasElement; y0: number; y1: number }>;
  stripScale: number;
  /** Document pages (a PDF or document viewer), in CSS px; null for ordinary pages. */
  sheets: SheetLayout | null;
}

/**
 * Streams every frame's own rows through the row analyzer (PAGINATION §4: ≤ 800 px wide,
 * one row per CSS px) and builds the long thumbnail strip on the way. Holds one frame's
 * pixels at a time.
 */
export async function analyze(
  s: LoadedSession,
  frames: FrameCache,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  const aw = Math.min(ANALYSIS_WIDTH, Math.round(s.width));
  const analyzer = new RowAnalyzer(aw, 1);
  const sheetAnalyzer = new SheetAnalyzer(aw);
  const stripScale = Math.min(1, STRIP_WIDTH / s.width);
  const strip: Analysis['strip'] = [];
  const bands = ownedBands(s.geoms);
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    const h = Math.round(band.y1 - band.y0);
    if (h <= 0) continue;
    const g = s.geoms[i]!;
    const bitmap = await frames.get(i);
    const sx = g.cropX;
    const sy = g.cropY + (band.y0 - g.docY) * g.dpr;
    const sw = s.width * g.dpr;
    const sh = h * g.dpr;

    const a = new OffscreenCanvas(aw, h);
    const actx = a.getContext('2d', { willReadFrequently: true })!;
    actx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, aw, h);
    const img = actx.getImageData(0, 0, aw, h);
    const grey = toGrey({ width: aw, height: h, data: img.data, channels: 4 });
    analyzer.push(grey);
    sheetAnalyzer.push(grey);

    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.width * stripScale));
    c.height = Math.max(1, Math.round(h * stripScale));
    c.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
    strip.push({ canvas: c, y0: band.y0, y1: band.y1 });
    onProgress?.(i + 1, bands.length);
    // Let the page paint between frames on long captures.
    await new Promise((r) => setTimeout(r, 0));
  }
  const found = detectSheets(sheetAnalyzer.finish());
  const k = s.width / aw; // analysis columns → CSS px (rows are already 1 per CSS px)
  const sheets = found && { ...found, x0: found.x0 * k, x1: found.x1 * k };
  return { rows: analyzer.finish(), strip, stripScale, sheets };
}
