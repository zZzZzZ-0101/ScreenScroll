import type { Px } from './geometry.js';

/**
 * PDF quality presets. Each says how fine the page images may be on paper and how they are
 * encoded. "Auto" picks per page by content (`chooseImageFormat`): PNG for text, UI and flat
 * graphics, which stay exact and small; JPEG for photos, at the preset's quality.
 *
 * Effective resolution on paper: an image px covers 1 / dpr CSS px, and a CSS px is `s` pt
 * wide, so dpi = dpr · 72 / s. A preset with a cap scales page images down to it, never up.
 */
export type ExportPreset = 'compact' | 'balanced' | 'best' | 'lossless';

export interface QualitySpec {
  id: ExportPreset;
  name: string;
  /** Highest image resolution on paper, or null for the captured pixels as they are. */
  maxDpi: number | null;
  /** 'auto' = PNG or JPEG by content; 'png' = PNG for every page. */
  format: 'auto' | 'png';
  /** JPEG quality, 0…1, for pages judged photographic. */
  jpegQuality: number;
  summary: string;
}

export const QUALITY: Record<ExportPreset, QualitySpec> = {
  compact: {
    id: 'compact',
    name: 'Compact',
    maxDpi: 150,
    format: 'auto',
    jpegQuality: 0.8,
    summary: 'Smallest file that still reads and prints well: text at 150 dpi stays sharp.',
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    maxDpi: 300,
    format: 'auto',
    jpegQuality: 0.9,
    summary: 'Print resolution (300 dpi, the usual print standard); photos as JPEG 90.',
  },
  best: {
    id: 'best',
    name: 'Best',
    maxDpi: null,
    format: 'auto',
    jpegQuality: 0.95,
    summary: 'Every captured pixel; photos as JPEG 95, text as PNG.',
  },
  lossless: {
    id: 'lossless',
    name: 'Lossless',
    maxDpi: null,
    format: 'png',
    jpegQuality: 1,
    summary: 'Exactly the captured pixels, PNG throughout. Largest file.',
  },
};

export const EXPORT_PRESETS: ExportPreset[] = ['compact', 'balanced', 'best', 'lossless'];

/** Image pixels per inch on paper for a capture at `dpr` laid out at `s` pt per CSS px. */
export function pageDpi(dpr: number, s: number): number {
  return (dpr * 72) / s;
}

/** Scale (≤ 1) to compose page images at, so they don't exceed the preset's resolution. */
export function exportScale(dpr: number, s: number, spec: QualitySpec): number {
  return spec.maxDpi ? Math.min(1, spec.maxDpi / pageDpi(dpr, s)) : 1;
}

/** Pixel size of a page image: `width` × `height` CSS px at `dpr`, scaled by `scale`. */
export function imagePx(width: Px, height: Px, dpr: number, scale: number) {
  return {
    w: Math.max(1, Math.round(width * dpr * scale)),
    h: Math.max(1, Math.round(height * dpr * scale)),
  };
}
