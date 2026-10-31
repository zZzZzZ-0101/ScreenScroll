import { PDFName, PDFNull, PDFString, type PDFDocument, type PDFPage } from 'pdf-lib';
import type { LinkRect } from '../hints.js';
import type { PageLayout } from '../layout.js';
import type { PageSlice } from '../paginate.js';
import { contentLayout, locate } from './locate.js';

/**
 * PDF_OUTPUT §3: a /Link annotation over every link rectangle shown on each page. External
 * links open their URL; links to an anchor on the captured page jump to the page showing it.
 * Rectangles crossing a page break get a clipped annotation on each page.
 */
export function addLinks(
  doc: PDFDocument,
  pages: readonly PDFPage[],
  slices: readonly PageSlice[],
  layout: PageLayout,
  links: readonly LinkRect[],
): number {
  const ctx = doc.context;
  const s = layout.s;
  let added = 0;
  slices.forEach((slice, i) => {
    const page = pages[i]!;
    for (const l of links) {
      const y0 = Math.max(l.rect.y, slice.y0);
      const y1 = Math.min(l.rect.y + l.rect.height, slice.y1);
      const x0 = Math.max(l.rect.x, slice.x0);
      const x1 = Math.min(l.rect.x + l.rect.width, slice.x1);
      if (y1 - y0 < 1 || x1 - x0 < 1) continue;
      const box = contentLayout(layout, slice).box;
      const rect = [
        box.x + (x0 - slice.x0) * s,
        layout.paperH - (box.y + (y1 - slice.y0) * s),
        box.x + (x1 - slice.x0) * s,
        layout.paperH - (box.y + (y0 - slice.y0) * s),
      ];
      let action: Record<string, unknown>;
      const dest = l.targetY === undefined ? null : locate(slices, layout, l.targetY);
      if (dest) {
        action = { Dest: [pages[dest.page]!.ref, PDFName.of('XYZ'), PDFNull, dest.top, PDFNull] };
      } else {
        action = { A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.href) } };
      }
      const annot = ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: rect,
          Border: [0, 0, 0],
          ...action,
        } as never),
      );
      page.node.addAnnot(annot);
      added++;
    }
  });
  return added;
}
