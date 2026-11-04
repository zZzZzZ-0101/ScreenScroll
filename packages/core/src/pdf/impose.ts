import { PDFDocument } from 'pdf-lib';

/** How pages go on paper: one per sheet, two side by side, or a folded booklet. */
export type Imposition = 'single' | '2up' | 'booklet';

/**
 * Order of page indexes on the sides of a saddle-stitched booklet (null = blank). Pages are
 * padded to a multiple of 4; sheet s carries [last − 2s, 2s] on its front and
 * [2s + 1, last − 2s − 1] on its back, so the folded stack reads in order. Print on both
 * sides, flipping on the short edge.
 */
export function bookletOrder(pages: number): Array<[number | null, number | null]> {
  const n = Math.ceil(pages / 4) * 4;
  const at = (i: number) => (i < pages ? i : null);
  const sides: Array<[number | null, number | null]> = [];
  for (let s = 0; s < n / 4; s++) {
    sides.push([at(n - 1 - 2 * s), at(2 * s)]);
    sides.push([at(2 * s + 1), at(n - 2 - 2 * s)]);
  }
  return sides;
}

/**
 * M8: puts a finished PDF's pages two to a landscape sheet of the same paper, in reading
 * order (2-up) or booklet order. Pages keep their look and searchable text; links and
 * bookmarks don't survive the step (they belong to the original pages).
 */
export async function impose(bytes: Uint8Array, mode: Imposition): Promise<Uint8Array> {
  if (mode === 'single') return bytes;
  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create({ updateMetadata: false });
  out.setTitle(src.getTitle() ?? '');
  out.setProducer(src.getProducer() ?? 'ScreenScroll');
  const pages = src.getPages();
  if (!pages.length) return bytes;
  const embedded = await out.embedPages(pages);
  const { width: w, height: h } = pages[0]!.getSize();
  // The same paper turned: two pages side by side in its halves.
  const sheetW = Math.max(w, h);
  const sheetH = Math.min(w, h);
  const half = sheetW / 2;
  const sides =
    mode === 'booklet'
      ? bookletOrder(pages.length)
      : Array.from(
          { length: Math.ceil(pages.length / 2) },
          (_, s): [number | null, number | null] => [
            2 * s,
            2 * s + 1 < pages.length ? 2 * s + 1 : null,
          ],
        );
  for (const side of sides) {
    const sheet = out.addPage([sheetW, sheetH]);
    side.forEach((i, k) => {
      if (i === null) return;
      const p = embedded[i]!;
      const scale = Math.min(half / p.width, sheetH / p.height);
      const pw = p.width * scale;
      const ph = p.height * scale;
      sheet.drawPage(p, {
        x: k * half + (half - pw) / 2,
        y: (sheetH - ph) / 2,
        xScale: scale,
        yScale: scale,
      });
    });
  }
  return out.save();
}
