import type { Px } from './geometry.js';

export type PaperId = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'Tabloid';

/** Paper sizes in mm, portrait (PAGINATION §1). */
export const PAPERS: Record<PaperId, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
  Tabloid: { w: 279.4, h: 431.8 },
};

export const PT_PER_MM = 72 / 25.4;
/** Print scale: 96 CSS px per inch = 72 pt per inch. */
export const PT_PER_CSS_PX_AT_100 = 0.75;

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSettings {
  paper: PaperId | { w: number; h: number }; // mm when custom
  orientation: 'portrait' | 'landscape';
  marginsMm: Margins;
  /** Space reserved for header/footer text, in pt (0 when off). */
  headerPt: number;
  footerPt: number;
  /** 'fit' fills the printable width; a number is a fixed print scale in percent. */
  scale: 'fit' | number;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  paper: 'A4',
  orientation: 'portrait',
  marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
  headerPt: 0,
  footerPt: 14,
  scale: 'fit',
};

export interface PageLayout {
  /** Paper size in pt. */
  paperW: number;
  paperH: number;
  /** Printable box for content, in pt from the top-left corner of the paper. */
  box: { x: number; y: number; w: number; h: number };
  /** pt per CSS px. */
  s: number;
  /** Target slice height in CSS px: the most content one page can hold. */
  T: Px;
  /** True when a fixed scale was reduced so the content fits the width. */
  scaleClamped: boolean;
}

/** PAGINATION §1: page geometry for content `contentWidth` CSS px wide. */
export function computeLayout(settings: PageSettings, contentWidth: Px): PageLayout {
  const mm = typeof settings.paper === 'string' ? PAPERS[settings.paper] : settings.paper;
  const [wMm, hMm] =
    settings.orientation === 'landscape'
      ? [Math.max(mm.w, mm.h), Math.min(mm.w, mm.h)]
      : [Math.min(mm.w, mm.h), Math.max(mm.w, mm.h)];
  const paperW = wMm * PT_PER_MM;
  const paperH = hMm * PT_PER_MM;
  const m = settings.marginsMm;
  const box = {
    x: m.left * PT_PER_MM,
    y: m.top * PT_PER_MM + settings.headerPt,
    w: paperW - (m.left + m.right) * PT_PER_MM,
    h: paperH - (m.top + m.bottom) * PT_PER_MM - settings.headerPt - settings.footerPt,
  };
  if (box.w <= 0 || box.h <= 0 || contentWidth <= 0) {
    throw new Error('Margins leave no room for content.');
  }
  const fit = box.w / contentWidth;
  let s = fit;
  let scaleClamped = false;
  if (settings.scale !== 'fit') {
    s = (PT_PER_CSS_PX_AT_100 * settings.scale) / 100;
    if (s > fit) {
      s = fit;
      scaleClamped = true;
    }
  }
  return { paperW, paperH, box, s, T: box.h / s, scaleClamped };
}

export const MIN_READABLE_PT = 7;

/**
 * PAGINATION §1 readability guard: warn when the typical text on the page would print
 * smaller than 7 pt, with what to try instead.
 */
export function readabilityAdvice(medianFontPx: number | null, s: number): string | null {
  if (!medianFontPx) return null;
  const pt = medianFontPx * s;
  if (pt >= MIN_READABLE_PT) return null;
  return `Text will be small (≈${pt.toFixed(1)} pt). Try: crop margins, landscape, or capture at 1000 px width.`;
}

/** Median of the font sizes of text runs, or null without text. */
export function medianFontPx(sizes: readonly number[]): number | null {
  if (!sizes.length) return null;
  const sorted = [...sizes].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** How big the page's text comes out on paper, and what two fixes would make of it. */
export interface PrintedText {
  /** Median text size on paper, pt: text px × s. */
  pt: number;
  /** The same in the other orientation (landscape is wider, so larger). */
  turnedPt: number;
  /** The same if the page were laid out `narrowTo` px wide (Settings → Page width). */
  narrowPt: number | null;
}

export function printedTextSize(
  fontPx: number,
  page: PageSettings,
  contentWidth: Px,
  narrowTo = 1000,
): PrintedText {
  const s = computeLayout(page, contentWidth).s;
  const turned = computeLayout(
    { ...page, orientation: page.orientation === 'landscape' ? 'portrait' : 'landscape' },
    contentWidth,
  ).s;
  return {
    pt: fontPx * s,
    turnedPt: fontPx * turned,
    narrowPt: contentWidth > narrowTo + 1 ? fontPx * computeLayout(page, narrowTo).s : null,
  };
}

/** A paper that matches a page shape (height ÷ width), for "as the original". */
export interface MatchedPaper {
  paper: PaperId | { w: number; h: number };
  orientation: 'portrait' | 'landscape';
  /** Plain name: "A4", "Letter landscape", "16:9 slide", "Custom 210 × 250 mm". */
  name: string;
}

/**
 * The paper a document page was most likely made on, from its shape: A4, Letter or Legal in
 * either orientation within 2.5%, slides (16:9, 4:3) on a 10-inch-wide page, else a custom
 * size at A4 width with the page's own shape.
 */
export function matchPaper(ratio: number): MatchedPaper {
  const near = (r: number) => Math.abs(ratio - r) / r <= 0.025;
  for (const id of ['A4', 'Letter', 'Legal'] as const) {
    const { w, h } = PAPERS[id];
    if (near(h / w)) return { paper: id, orientation: 'portrait', name: id };
    if (near(w / h)) return { paper: id, orientation: 'landscape', name: `${id} landscape` };
  }
  for (const [r, name] of [
    [9 / 16, '16:9 slide'],
    [3 / 4, '4:3 slide'],
  ] as const)
    if (near(r)) return { paper: { w: 254, h: 254 * r }, orientation: 'portrait', name };
  const h = Math.round(210 * ratio);
  return { paper: { w: 210, h }, orientation: 'portrait', name: `Custom 210 × ${h} mm` };
}
