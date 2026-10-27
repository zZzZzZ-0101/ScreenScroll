import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import type { PageLayout } from '../layout.js';
import type { PageSlice } from '../paginate.js';

/** One composed page image (never taller than one page plus overlap, PDF_OUTPUT §1). */
export interface PageImage {
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
  slice: PageSlice;
}

export interface PdfMeta {
  title: string;
  url: string;
  capturedAt: Date;
}

export interface PdfOptions {
  /** Default footer: "{domain} · {date}" left, "{page}/{pages}" right (PDF_OUTPUT §4). */
  footer: boolean;
  /** Small "continued" note above pages that start with a forced-cut overlap. */
  continuedMarker: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = { footer: true, continuedMarker: true };

/** Acrobat's maximum page side is 200 in = 14,400 pt; stay below it (PDF_OUTPUT §6). */
export const MAX_PAGE_PT = 14_000;

const GREY = rgb(0.45, 0.45, 0.45);

/**
 * PDF_OUTPUT §1: one PDF page per slice, the image top-aligned in the printable box at
 * scale s. Images are embedded at native pixels; the PDF scale sets their size.
 */
export async function buildPdf(
  pages: Iterable<PageImage> | AsyncIterable<PageImage>,
  pageCount: number,
  layout: PageLayout,
  meta: PdfMeta,
  options: Partial<PdfOptions> = {},
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  // updateMetadata: false, or pdf-lib stamps its own producer over ours.
  const doc = await PDFDocument.create({ updateMetadata: false });
  setMeta(doc, meta);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let n = 0;
  for await (const p of pages) {
    n++;
    const page = doc.addPage([layout.paperW, layout.paperH]);
    const img = await embed(doc, p);
    const w = (p.slice.x1 - p.slice.x0) * layout.s;
    const h = (p.slice.y1 - p.slice.y0) * layout.s;
    const top = layout.paperH - layout.box.y; // pdf-lib's origin is bottom-left
    page.drawImage(img, { x: layout.box.x, y: top - h, width: w, height: h });
    if (opts.continuedMarker && p.slice.overlapTop > 0) {
      const text = 'continued from previous page';
      const size = 6.5;
      page.drawText(text, {
        x: layout.box.x + layout.box.w - font.widthOfTextAtSize(text, size),
        y: top + 3,
        size,
        font,
        color: GREY,
      });
    }
    if (opts.footer) drawFooter(page, font, layout, meta, n, pageCount);
  }
  return doc.save();
}

/**
 * PDF_OUTPUT §6 "single long page": every slice stacked on one page, refused above
 * 14,000 pt. Takes the same per-page images, so no tall canvas is needed.
 */
export async function buildSingleLongPagePdf(
  pages: Iterable<PageImage> | AsyncIterable<PageImage>,
  totalHeightCss: number,
  layout: PageLayout,
  meta: PdfMeta,
): Promise<Uint8Array> {
  const margin = layout.box.x;
  const height = totalHeightCss * layout.s + 2 * margin;
  if (height > MAX_PAGE_PT) {
    throw new Error(
      `The page would be ${Math.round(height)} pt tall; PDF readers allow about 14,000 pt. Use multi-page PDF instead.`,
    );
  }
  const doc = await PDFDocument.create({ updateMetadata: false });
  setMeta(doc, meta);
  const page = doc.addPage([layout.paperW, height]);
  let y = height - margin;
  for await (const p of pages) {
    const img = await embed(doc, p);
    const w = (p.slice.x1 - p.slice.x0) * layout.s;
    const full = (p.slice.y1 - p.slice.y0) * layout.s;
    // A forced-cut overlap repeats rows already drawn; shifting the image up by it lays
    // those identical pixels over themselves, so nothing appears twice.
    const skip = p.slice.overlapTop * layout.s;
    page.drawImage(img, { x: margin, y: y - full + skip, width: w, height: full });
    y -= full - skip;
  }
  return doc.save();
}

function setMeta(doc: PDFDocument, meta: PdfMeta): void {
  doc.setTitle(meta.title || meta.url);
  doc.setSubject(meta.url);
  doc.setProducer('ScrollPress');
  doc.setCreator('ScrollPress');
  doc.setCreationDate(meta.capturedAt);
  doc.setModificationDate(meta.capturedAt);
}

async function embed(doc: PDFDocument, p: PageImage): Promise<PDFImage> {
  return p.format === 'png' ? doc.embedPng(p.bytes) : doc.embedJpg(p.bytes);
}

function drawFooter(
  page: ReturnType<PDFDocument['addPage']>,
  font: PDFFont,
  layout: PageLayout,
  meta: PdfMeta,
  n: number,
  total: number,
): void {
  const size = 8;
  const y = layout.paperH - (layout.box.y + layout.box.h) - size - 4;
  let domain = '';
  try {
    domain = new URL(meta.url).hostname.replace(/^www\./, '');
  } catch {
    // Imported files have no URL; the footer then shows only the date.
  }
  const date = meta.capturedAt.toISOString().slice(0, 10);
  const left = winAnsiSafe(domain ? `${domain} · ${date}` : date);
  const right = `${n}/${total}`;
  page.drawText(left, { x: layout.box.x, y, size, font, color: GREY });
  page.drawText(right, {
    x: layout.box.x + layout.box.w - font.widthOfTextAtSize(right, size),
    y,
    size,
    font,
    color: GREY,
  });
}

/** Helvetica only covers WinAnsi; anything else becomes "?" (Unicode footers come in M3). */
function winAnsiSafe(s: string): string {
  return s.replace(/[^ -~ -ÿ]/g, '?');
}
