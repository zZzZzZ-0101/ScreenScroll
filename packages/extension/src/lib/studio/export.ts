import type { PageLayout, PageSlice } from '@scrollpress/core';
import {
  buildPdf,
  buildSingleLongPagePdf,
  type PageImage,
  type PdfMeta,
} from '@scrollpress/core/pdf';
import { zipSync } from 'fflate';
import { composePage, encodePage, type ImageMode } from './compose';
import type { FrameCache, LoadedSession } from './session';

export type Progress = (done: number, total: number) => void;

async function* pageImages(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  mode: ImageMode,
  onProgress?: Progress,
): AsyncGenerator<PageImage> {
  for (let i = 0; i < slices.length; i++) {
    const canvas = await composePage(s, frames, slices[i]!);
    yield await encodePage(canvas, slices[i]!, mode);
    onProgress?.(i + 1, slices.length);
  }
}

export function metaOf(s: LoadedSession): PdfMeta {
  return { title: s.session.title, url: s.session.url, capturedAt: new Date(s.session.capturedAt) };
}

/** PDF_OUTPUT §6 default: multi-page PDF, pages composed and encoded one at a time. */
export function exportPdf(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  layout: PageLayout,
  mode: ImageMode,
  onProgress?: Progress,
): Promise<Uint8Array> {
  return buildPdf(
    pageImages(s, frames, slices, mode, onProgress),
    slices.length,
    layout,
    metaOf(s),
  );
}

export function exportLongPagePdf(
  s: LoadedSession,
  frames: FrameCache,
  slices: PageSlice[],
  layout: PageLayout,
  mode: ImageMode,
  onProgress?: Progress,
): Promise<Uint8Array> {
  const total = slices.reduce((h, sl) => h + sl.y1 - sl.y0 - sl.overlapTop, 0);
  return buildSingleLongPagePdf(
    pageImages(s, frames, slices, mode, onProgress),
    total,
    layout,
    metaOf(s),
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
): Promise<Uint8Array> {
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const digits = String(slices.length).length;
  for (let i = 0; i < slices.length; i++) {
    const canvas = await composePage(s, frames, slices[i]!);
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
): Promise<Blob[]> {
  const partCss = Math.floor(LONG_IMAGE_MAX / s.dpr);
  const parts: Blob[] = [];
  const count = Math.ceil(s.height / partCss);
  for (let k = 0; k < count; k++) {
    const y0 = k * partCss;
    const y1 = Math.min(s.height, y0 + partCss);
    const canvas = await composePage(s, frames, { ...crop, y0, y1 });
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

/** Saves through chrome.downloads so the browser's download settings apply. */
export async function download(
  data: Uint8Array | Blob,
  filename: string,
  mime: string,
): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // The download has its own copy once started; keep the URL a little for slow starts.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Copies one page as PNG (UI §3, Ctrl+Shift+C). */
export async function copyPageImage(
  s: LoadedSession,
  frames: FrameCache,
  slice: PageSlice,
): Promise<void> {
  const canvas = await composePage(s, frames, slice);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Print: open the PDF in the browser's viewer, which has the print dialog (UI §3). */
export function openPdfForPrint(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  void chrome.tabs.create({ url });
}
