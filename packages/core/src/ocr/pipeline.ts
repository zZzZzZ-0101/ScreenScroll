import { ctcDecode } from './ctc.js';
import { dbBoxes, mergeTileBoxes, tiles, type DetBox } from './db.js';
import { roundUp, toTensor } from './prep.js';
import type { EngineDescriptor, OcrLine, OcrRuntime, Rgba } from './types.js';

/** Detection px from a shared tile edge within which a box may be cut (bundle: 32). */
const BOUNDARY_MARGIN = 32;

export interface OcrOptions {
  /**
   * Detection works best on text 10–40 px tall; small screen text (standard-resolution
   * captures) is enlarged by this factor for detection only. Recognition always reads the
   * original pixels.
   */
  detScale?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Reads the text in an image: detection on overlapping tiles, boxes merged, then each line
 * recognised, in reading order (top to bottom, then left to right on a line).
 */
export async function readText(
  img: Rgba,
  engine: EngineDescriptor,
  rt: OcrRuntime,
  dictionary: readonly string[],
  opts: OcrOptions = {},
): Promise<OcrLine[]> {
  const { det, rec } = engine;
  const f = opts.detScale ?? 1;
  // Tiles are cut in detection pixels, then mapped back.
  const sw = Math.round(img.width * f);
  const sh = Math.round(img.height * f);
  const parts = tiles(sw, sh, det.tileSide, det.overlap);
  const found: DetBox[] = [];
  let done = 0;
  for (const t of parts) {
    const tw = roundUp(t.w, det.multiple);
    const th = roundUp(t.h, det.multiple);
    const input = toTensor(
      img,
      { x: t.x / f, y: t.y / f, w: t.w / f, h: t.h / f },
      t.w,
      t.h,
      tw,
      th,
      det,
    );
    const out = await rt.run('det', input);
    const [, , oh, ow] = out.dims as [number, number, number, number];
    for (const b of dbBoxes(out.data, ow, oh, det)) {
      // Boxes in the padding are not text.
      if (b.x >= t.w || b.y >= t.h) continue;
      const w = Math.min(b.w, t.w - b.x);
      const h = Math.min(b.h, t.h - b.y);
      // Near an edge this tile shares with another, the text may run on: such a box only
      // wins when no neighbour saw the text whole.
      const m = BOUNDARY_MARGIN;
      const cut =
        (t.x > 0 && b.x < m) ||
        (t.y > 0 && b.y < m) ||
        (t.x + t.w < sw && b.x + w > t.w - m) ||
        (t.y + t.h < sh && b.y + h > t.h - m);
      found.push({
        x: (t.x + b.x) / f,
        y: (t.y + b.y) / f,
        w: w / f,
        h: h / f,
        score: b.score,
        cut,
      });
    }
    opts.onProgress?.(++done, parts.length * 2);
  }
  const boxes = readingOrder(mergeTileBoxes(found));
  const lines: OcrLine[] = [];
  let k = 0;
  for (const b of boxes) {
    const outW = Math.min(rec.maxWidth, Math.max(1, Math.ceil((rec.height * b.w) / b.h)));
    const tensorW = Math.max(rec.minWidth, outW);
    const input = toTensor(img, b, outW, rec.height, tensorW, rec.height, rec);
    const out = await rt.run('rec', input);
    const [, steps, classes] = out.dims as [number, number, number];
    const { text, confidence } = ctcDecode(out.data, steps, classes, dictionary, rec.blankIndex);
    if (text.trim())
      lines.push({ text: text.trim(), confidence, box: { x: b.x, y: b.y, w: b.w, h: b.h } });
    opts.onProgress?.(
      parts.length + Math.round((++k / boxes.length) * parts.length),
      parts.length * 2,
    );
  }
  return lines;
}

/** Top to bottom; boxes whose vertical centres are within half a line are one row, left to right. */
export function readingOrder<T extends { x: number; y: number; h: number }>(boxes: T[]): T[] {
  const byY = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: T[][] = [];
  for (const b of byY) {
    const row = rows.at(-1);
    const c = b.y + b.h / 2;
    const last = row?.at(-1);
    if (row && last && Math.abs(c - (last.y + last.h / 2)) < Math.min(b.h, last.h) / 2) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}
