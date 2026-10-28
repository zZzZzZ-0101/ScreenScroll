import { rgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PageLayout } from '../layout.js';
import { drawTextRuns, type TextLayerFont } from './textlayer.js';

/** Left / centre / right texts of one band, with tokens (PDF_OUTPUT §4). */
export interface BandTemplate {
  left: string;
  center: string;
  right: string;
}

export const EMPTY_BAND: BandTemplate = { left: '', center: '', right: '' };
export const DEFAULT_FOOTER: BandTemplate = {
  left: '{domain} · {date}',
  center: '',
  right: '{page}/{pages}',
};

export interface BandTokens {
  title: string;
  url: string;
  domain: string;
  date: string;
  time: string;
  page: number;
  pages: number;
}

export function fillTemplate(template: string, t: BandTokens): string {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in t ? String(t[k as keyof BandTokens]) : m))
    .trim();
}

export function bandTokens(
  meta: { title: string; url: string; capturedAt: Date },
  page: number,
  pages: number,
): BandTokens {
  let domain = '';
  try {
    domain = new URL(meta.url).hostname.replace(/^www\./, '');
  } catch {
    // Imported files have no URL.
  }
  const d = meta.capturedAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    title: meta.title,
    url: meta.url,
    domain,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    page,
    pages,
  };
}

/** Draws text the browser can render in any script (titles in Chinese, Arabic…) as an image. */
export type TextRenderer = (
  text: string,
  sizePt: number,
) => Promise<{ png: Uint8Array; widthPt: number; heightPt: number }>;

const GREY = rgb(0.45, 0.45, 0.45);
export const BAND_FONT_PT = 8;

/** Helvetica in pdf-lib only encodes WinAnsi; everything else needs the renderer. */
export function isWinAnsi(s: string): boolean {
  return Array.from(s).every((ch) => {
    const c = ch.codePointAt(0)!;
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || '·–—‘’“”•…€'.includes(ch);
  });
}

/**
 * One header or footer line. Latin text is real Helvetica text; other scripts are drawn by
 * `render` and get an invisible text twin so they stay searchable. Without a renderer,
 * unsupported characters become "?" rather than failing.
 */
export async function drawBand(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  textFont: () => TextLayerFont,
  layout: PageLayout,
  band: BandTemplate,
  tokens: BandTokens,
  baselineY: number,
  render?: TextRenderer,
): Promise<void> {
  const size = BAND_FONT_PT;
  const slots: Array<[keyof BandTemplate, string]> = (['left', 'center', 'right'] as const).map(
    (k) => [k, fillTemplate(band[k], tokens)],
  );
  for (const [slot, text] of slots) {
    if (!text) continue;
    const place = (w: number) =>
      slot === 'left'
        ? layout.box.x
        : slot === 'right'
          ? layout.box.x + layout.box.w - w
          : layout.box.x + (layout.box.w - w) / 2;
    if (isWinAnsi(text) || !render) {
      const safe = Array.from(text, (ch) => (isWinAnsi(ch) ? ch : '?')).join('');
      page.drawText(safe, {
        x: place(font.widthOfTextAtSize(safe, size)),
        y: baselineY,
        size,
        font,
        color: GREY,
      });
      continue;
    }
    const img = await render(text, size);
    const embedded = await doc.embedPng(img.png);
    const x = place(img.widthPt);
    // The image is a text line box; put its baseline (≈ 80% down) on the band's baseline.
    const bottom = baselineY - 0.2 * img.heightPt;
    page.drawImage(embedded, { x, y: bottom, width: img.widthPt, height: img.heightPt });
    drawTextRuns(page, textFont(), [
      { text, x, y: baselineY, size: img.heightPt, width: img.widthPt },
    ]);
  }
}
