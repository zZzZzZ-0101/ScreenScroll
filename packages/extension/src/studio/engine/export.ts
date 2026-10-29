import {
  QUALITY,
  exportScale,
  redactions,
  type Annotation,
  type ExportPreset,
  type FilterId,
  type PageLayout,
  type PageSlice,
  type Rect,
} from '@screenscroll/core';
import {
  buildPdf,
  buildSingleLongPagePdf,
  type PageImage,
  type PdfContent,
  type PdfMeta,
  type PdfOptions,
} from '@screenscroll/core/pdf';
import { ocrRuns, type OcrLine } from '@screenscroll/core/ocr';
import { zipSync } from 'fflate';
import type { PdfSettings } from '@/shared/settings';
import { composePage, encodePage } from './compose';
import { renderBandText } from './render-text';
import type { FrameCache, LoadedSession } from './session';

export type Progress = (done: number, total: number) => void;

/** Text recognition for the pages that need it (Settings → Text recognition). */
export interface PageOcr {
  /** Indices of the pages to read. */
  pages: ReadonlySet<number>;
  read: (img: ImageData, detScale: number) => Promise<OcrLine[]>;
}

async function* pageImages(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  layout: PageLayout,
  preset: ExportPreset,
  onProgress?: Progress,
  annotations: readonly Annotation[] = [],
  filter: FilterId = 'original',
  ocr?: PageOcr,
): AsyncGenerator<PageImage> {
  const spec = QUALITY[preset];
  const scale = exportScale(s.dpr, layout.s, spec);
  const pxPerCss = s.dpr * scale;
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!;
    const canvas = await composePage(s, frames, slice, scale, annotations, filter);
    const page = await encodePage(canvas, slice, spec);
    if (ocr?.pages.has(i)) {
      // Read the page as it will look (filter and redactions applied); small text is
      // enlarged for detection.
      const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      const lines = await ocr.read(img, pxPerCss < 1.5 ? 2 : 1);
      page.textRuns = ocrRuns(lines, slice, pxPerCss, s.hints.textRuns);
    }
    yield page;
    onProgress?.(i + 1, slices.length);
  }
}

export function metaOf(s: LoadedSession): PdfMeta {
  return { title: s.session.title, url: s.session.url, capturedAt: new Date(s.session.capturedAt) };
}

function pdfOptions(pdf: PdfSettings): Partial<PdfOptions> {
  return { ...pdf, renderText: renderBandText };
}

/**
 * What the DOM told us: text for the invisible layer, links, headings for bookmarks. Anything
 * under a blur or pixelate area is left out, or the redacted text would still be searchable.
 */
function contentOf(s: LoadedSession, annotations: readonly Annotation[]): PdfContent {
  const hidden = redactions(annotations);
  const visible = (r: Rect) =>
    !hidden.some(
      (h) =>
        r.x < h.x + h.width && r.x + r.width > h.x && r.y < h.y + h.height && r.y + r.height > h.y,
    );
  return {
    textRuns: s.hints.textRuns.filter((t) => visible(t.rect)),
    links: s.hints.links.filter((l) => visible(l.rect)),
    headings: s.hints.headings.filter((h) => visible({ x: 0, y: h.y, width: s.width, height: 1 })),
  };
}

/** PDF_OUTPUT §6 default: multi-page PDF, pages composed and encoded one at a time. */
export function exportPdf(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  layout: PageLayout,
  preset: ExportPreset,
  pdf: PdfSettings,
  onProgress?: Progress,
  annotations: readonly Annotation[] = [],
  ocr?: PageOcr,
): Promise<Uint8Array> {
  return buildPdf(
    pageImages(s, frames, slices, layout, preset, onProgress, annotations, pdf.filter, ocr),
    slices.length,
    layout,
    metaOf(s),
    pdfOptions(pdf),
    contentOf(s, annotations),
  );
}

export function exportLongPagePdf(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  layout: PageLayout,
  preset: ExportPreset,
  pdf: PdfSettings,
  onProgress?: Progress,
  annotations: readonly Annotation[] = [],
  ocr?: PageOcr,
): Promise<Uint8Array> {
  const total = slices.reduce((h, sl) => h + sl.y1 - sl.y0 - sl.overlapTop, 0);
  return buildSingleLongPagePdf(
    pageImages(s, frames, slices, layout, preset, onProgress, annotations, pdf.filter, ocr),
    total,
    layout,
    metaOf(s),
    pdfOptions(pdf),
    contentOf(s, annotations),
  );
}

export type RasterFormat = 'png' | 'jpeg' | 'webp';
const MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** One image per page, zipped (PDF_OUTPUT §6). Images are already compressed: zip stores them. */
export async function exportPageImagesZip(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  format: RasterFormat,
  baseName: string,
  onProgress?: Progress,
  annotations: readonly Annotation[] = [],
  filter: FilterId = 'original',
): Promise<Uint8Array> {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const digits = String(slices.length).length;
  for (let i = 0; i < slices.length; i++) {
    const canvas = await composePage(s, frames, slices[i]!, 1, annotations, filter);
    const blob = await canvas.convertToBlob({ type: MIME[format], quality: 0.92 });
    files[`${baseName}-${String(i + 1).padStart(digits, '0')}.${ext(format)}`] = [
      new Uint8Array(await blob.arrayBuffer()),
      { level: 0 },
    ];
    onProgress?.(i + 1, slices.length);
  }
  return zipSync(files);
}

/** Tallest part of a long-image export, in device px (PDF_OUTPUT §6). */
export const LONG_IMAGE_MAX = 16_384;

/**
 * The whole capture as one image, split into parts of at most 16,384 px when taller.
 * Returns one blob per part; the caller zips several.
 */
export async function exportLongImage(
  s: LoadedSession,
  frames: FrameCache,
  crop: { x0: number; x1: number },
  format: RasterFormat,
  onProgress?: Progress,
  annotations: readonly Annotation[] = [],
  range: { y0: number; y1: number } = { y0: 0, y1: s.height },
  filter: FilterId = 'original',
): Promise<Blob[]> {
  const partCss = Math.floor(LONG_IMAGE_MAX / s.dpr);
  const parts: Blob[] = [];
  const count = Math.ceil((range.y1 - range.y0) / partCss);
  for (let k = 0; k < count; k++) {
    const y0 = range.y0 + k * partCss;
    const y1 = Math.min(range.y1, y0 + partCss);
    const canvas = await composePage(s, frames, { ...crop, y0, y1 }, 1, annotations, filter);
    parts.push(await canvas.convertToBlob({ type: MIME[format], quality: 0.92 }));
    onProgress?.(k + 1, count);
  }
  return parts;
}

export function zipBlobs(parts: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  return zipSync(Object.fromEntries(parts.map((p) => [p.name, [p.bytes, { level: 0 }]])));
}

export function ext(format: RasterFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

/**
 * Saves through chrome.downloads so the browser's download settings apply. Returns the name
 * used: if the browser refuses the name (some file systems and locales can't hold every
 * title), the file is saved under a plain name instead of not at all.
 */
export async function download(
  data: Uint8Array | Blob,
  filename: string,
  mime: string,
): Promise<string> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    for (const name of [filename, fallbackName(filename)]) {
      // e2e only: the test browser renames downloads, so record the name we asked for.
      if (__SP_E2E__) await chrome.storage.session.set({ lastDownload: name });
      try {
        await chrome.downloads.download({ url, filename: name, saveAs: false });
        return name;
      } catch (e) {
        if (name !== filename || !/invalid filename/i.test(String(e))) throw e;
      }
    }
    throw new Error('The browser refused to save the file.');
  } finally {
    // The download has its own copy once started; keep the URL a little for slow starts.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** ASCII-only name with the same date part and extension, e.g. capture_2026-10-28_0915.pdf. */
export function fallbackName(filename: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1] ?? 'bin';
  const date = /\d{4}-\d{2}-\d{2}(_\d{4})?/.exec(filename)?.[0];
  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_ ]+|[_ ]+$/g, '');
  return `${/[A-Za-z0-9]{3}/.test(base) ? base.slice(0, 80) : `capture${date ? `_${date}` : ''}`}.${ext}`;
}

/** Copies one page as PNG (UI §3, Ctrl+Shift+C). */
export async function copyPageImage(
  s: LoadedSession,
  frames: FrameCache,
  slice: PageSlice,
  annotations: readonly Annotation[] = [],
  filter: FilterId = 'original',
): Promise<void> {
  const canvas = await composePage(s, frames, slice, 1, annotations, filter);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Print: open the PDF in the browser's viewer, which has the print dialog (UI §3). */
export function openPdfForPrint(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  void chrome.tabs.create({ url });
}
