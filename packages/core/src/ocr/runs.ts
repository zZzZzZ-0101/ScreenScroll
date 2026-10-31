import type { TextRun } from '../hints.js';
import type { Rect } from '../geometry.js';
import type { OcrLine } from './types.js';

/** Settings → Text recognition. */
export type OcrMode = 'auto' | 'always' | 'off';

/** Lines read with less confidence than this are left out of the text layer. */
export const MIN_CONFIDENCE = 0.5;

/**
 * OCR lines from a page image of `slice` (image px at `pxPerCss`) as text runs in document
 * coordinates, for the PDF text layer. Lines that overlap text the page already provides are
 * dropped, so nothing is searchable twice.
 */
export function ocrRuns(
  lines: readonly OcrLine[],
  slice: { x0: number; y0: number; repeat?: { y0: number; y1: number } },
  pxPerCss: number,
  existing: readonly { rect: Rect }[] = [],
): TextRun[] {
  const out: TextRun[] = [];
  // A repeated table header sits above the slice's rows in the image; its text is already
  // where the header first appears, so it is skipped here.
  const head = slice.repeat ? slice.repeat.y1 - slice.repeat.y0 : 0;
  for (const l of lines) {
    if (l.confidence < MIN_CONFIDENCE) continue;
    if (head && (l.box.y + l.box.h / 2) / pxPerCss < head) continue;
    const rect = {
      x: slice.x0 + l.box.x / pxPerCss,
      y: slice.y0 + l.box.y / pxPerCss - head,
      width: l.box.w / pxPerCss,
      height: l.box.h / pxPerCss,
    };
    const covered = existing.some((e) => overlap(e.rect, rect) > 0.5 * rect.width * rect.height);
    if (!covered) out.push({ text: l.text, rect, fontSizePx: rect.height });
  }
  return out;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Which pages to read. Always: every page. Auto: pages whose own text (from the page's DOM)
 * is missing or nearly so: document viewers that draw pages as pictures, canvas apps,
 * scanned images. Pages with real text already have it exactly.
 */
export function pagesNeedingOcr(
  mode: OcrMode,
  slices: readonly { x0: number; x1: number; y0: number; y1: number }[],
  runs: readonly { rect: Rect; text: string }[],
): number[] {
  if (mode === 'off') return [];
  return slices.flatMap((s, i) => {
    if (mode === 'always') return [i];
    let chars = 0;
    for (const r of runs) {
      const cy = r.rect.y + r.rect.height / 2;
      const cx = r.rect.x + r.rect.width / 2;
      if (cy >= s.y0 && cy < s.y1 && cx >= s.x0 && cx < s.x1) chars += r.text.trim().length;
    }
    return chars < 20 ? [i] : [];
  });
}
