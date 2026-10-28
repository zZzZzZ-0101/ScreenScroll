import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import type { Heading, LinkRect, TextRun } from '../hints.js';
import type { PageLayout } from '../layout.js';
import type { PageSlice } from '../paginate.js';
import {
  bandTokens,
  DEFAULT_FOOTER,
  drawBand,
  EMPTY_BAND,
  type BandTemplate,
  type TextRenderer,
} from './bands.js';
import { addLinks } from './links.js';
import { addOutline, outlineItems, writeOutline, type OutlineItem } from './outline.js';
import { drawTextRuns, placeRuns, TextLayerFont } from './textlayer.js';

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
  /** Header and footer templates (PDF_OUTPUT §4); empty slots draw nothing. Space for them
   * must be reserved in the layout (headerPt / footerPt). */
  header: BandTemplate;
  footer: BandTemplate;
  /** Small "continued" note above pages that start with a forced-cut overlap. */
  continuedMarker: boolean;
  /** Invisible, searchable text from the DOM (PDF_OUTPUT §2). */
  textLayer: boolean;
  /** Clickable links (PDF_OUTPUT §3). */
  links: boolean;
  /** Bookmarks from h1–h3 (PDF_OUTPUT §5). */
  outline: boolean;
  /** Renders header/footer text Helvetica can't (non-Latin titles). */
  renderText?: TextRenderer;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  header: EMPTY_BAND,
  footer: DEFAULT_FOOTER,
  continuedMarker: true,
  textLayer: true,
  links: true,
  outline: true,
};

/** What the DOM told us about the page, in document CSS px. */
export interface PdfContent {
  textRuns?: readonly TextRun[];
  links?: readonly LinkRect[];
  headings?: readonly Heading[];
}

/** Acrobat's maximum page side is 200 in = 14,400 pt; stay below it (PDF_OUTPUT §6). */
export const MAX_PAGE_PT = 14_000;

const GREY = rgb(0.45, 0.45, 0.45);
/** Gap between the content box and header/footer text, pt. */
const BAND_GAP = 4;

/**
 * PDF_OUTPUT §1: one PDF page per slice, the image top-aligned in the printable box at
 * scale s. Images are embedded at native pixels; the PDF scale sets their size.
 */
export function buildPdf(
  pages: Iterable<PageImage> | AsyncIterable<PageImage>,
  pageCount: number,
  layout: PageLayout,
  meta: PdfMeta,
  options: Partial<PdfOptions> = {},
  content: PdfContent = {},
): Promise<Uint8Array> {
  return buildMergedPdf([{ pages, pageCount, layout, meta, content }], meta, options);
}

/** One capture's pages in a merged PDF (UI §5). */
export interface PdfPart {
  pages: Iterable<PageImage> | AsyncIterable<PageImage>;
  pageCount: number;
  /** Same paper for every part (L12); the scale may differ with each capture's width. */
  layout: PageLayout;
  meta: PdfMeta;
  content?: PdfContent;
}

/**
 * Several captures in one PDF. Header and footer tokens use each part's title and URL with
 * page numbers across the whole document; with more than one part, each gets a top-level
 * bookmark holding its own headings.
 */
export async function buildMergedPdf(
  parts: readonly PdfPart[],
  meta: PdfMeta,
  options: Partial<PdfOptions> = {},
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  // updateMetadata: false, or pdf-lib stamps its own producer over ours.
  const doc = await PDFDocument.create({ updateMetadata: false });
  setMeta(doc, meta);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let textFont: TextLayerFont | null = null;
  const getTextFont = () => (textFont ??= new TextLayerFont(doc));
  const total = parts.reduce((n, p) => n + p.pageCount, 0);
  const bookmarks: OutlineItem[] = [];
  let n = 0;
  for (const part of parts) {
    const { layout, content = {} } = part;
    const runs = opts.textLayer ? (content.textRuns ?? []) : [];
    const added: PDFPage[] = [];
    const slices: PageSlice[] = [];
    for await (const p of part.pages) {
      n++;
      const page = doc.addPage([layout.paperW, layout.paperH]);
      added.push(page);
      slices.push(p.slice);
      const img = await embed(doc, p);
      const w = (p.slice.x1 - p.slice.x0) * layout.s;
      const h = (p.slice.y1 - p.slice.y0) * layout.s;
      const top = layout.paperH - layout.box.y; // pdf-lib's origin is bottom-left
      page.drawImage(img, { x: layout.box.x, y: top - h, width: w, height: h });
      if (runs.length) drawTextRuns(page, getTextFont(), placeRuns(runs, p.slice, layout));
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
      const tokens = bandTokens(part.meta, n, total);
      const footerY = layout.paperH - (layout.box.y + layout.box.h) - BAND_GAP - 8;
      const headerY = layout.paperH - layout.box.y + BAND_GAP;
      for (const [band, y] of [
        [opts.header, headerY],
        [opts.footer, footerY],
      ] as const) {
        await drawBand(doc, page, font, getTextFont, layout, band, tokens, y, opts.renderText);
      }
    }
    if (opts.links && content.links?.length) addLinks(doc, added, slices, layout, content.links);
    const headings =
      opts.outline && content.headings?.length
        ? outlineItems(added, slices, layout, content.headings)
        : [];
    if (parts.length === 1) bookmarks.push(...headings);
    else if (added.length) {
      bookmarks.push({
        title: part.meta.title || part.meta.url,
        page: added[0]!.ref,
        top: layout.paperH,
        children: headings,
      });
    }
  }
  writeOutline(doc, bookmarks);
  (textFont as TextLayerFont | null)?.finish();
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
  options: Partial<PdfOptions> = {},
  content: PdfContent = {},
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
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
  let crop: { x0: number; x1: number } | null = null;
  for await (const p of pages) {
    crop ??= { x0: p.slice.x0, x1: p.slice.x1 };
    const img = await embed(doc, p);
    const w = (p.slice.x1 - p.slice.x0) * layout.s;
    const full = (p.slice.y1 - p.slice.y0) * layout.s;
    // A forced-cut overlap repeats rows already drawn; shifting the image up by it lays
    // those identical pixels over themselves, so nothing appears twice.
    const skip = p.slice.overlapTop * layout.s;
    page.drawImage(img, { x: margin, y: y - full + skip, width: w, height: full });
    y -= full - skip;
  }
  if (crop) {
    // The whole capture is one slice on one tall "paper": the same text, link and bookmark
    // code then works unchanged.
    const one: PageSlice = {
      y0: 0,
      y1: totalHeightCss,
      ...crop,
      overlapTop: 0,
      breakKind: 'end',
      cost: 0,
      warnings: [],
    };
    const tall: PageLayout = {
      ...layout,
      paperH: height,
      box: { x: margin, y: margin, w: layout.box.w, h: height - 2 * margin },
    };
    const runs = opts.textLayer ? (content.textRuns ?? []) : [];
    if (runs.length) {
      const font = new TextLayerFont(doc);
      drawTextRuns(page, font, placeRuns(runs, one, tall));
      font.finish();
    }
    if (opts.links && content.links?.length) addLinks(doc, [page], [one], tall, content.links);
    if (opts.outline && content.headings?.length)
      addOutline(doc, [page], [one], tall, content.headings);
  }
  return doc.save();
}

function setMeta(doc: PDFDocument, meta: PdfMeta): void {
  doc.setTitle(meta.title || meta.url);
  doc.setSubject(meta.url);
  doc.setProducer('ScreenScroll');
  doc.setCreator('ScreenScroll');
  doc.setCreationDate(meta.capturedAt);
  doc.setModificationDate(meta.capturedAt);
}

async function embed(doc: PDFDocument, p: PageImage): Promise<PDFImage> {
  return p.format === 'png' ? doc.embedPng(p.bytes) : doc.embedJpg(p.bytes);
}
