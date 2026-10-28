import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_FOOTER,
  DEFAULT_PAGE_SETTINGS,
  EMPTY_BAND,
  type BandTemplate,
  type PageSettings,
} from '@scrollpress/core';
import type { ImageMode } from './studio/compose';

export interface Settings {
  page: PageSettings;
  /** PAGINATION §6: crop empty side margins automatically, or keep the full width. */
  crop: 'auto' | 'off';
  /** "Fewer pages ↔ cleaner breaks", 0…1. */
  breakStyle: number;
  imageMode: ImageMode;
  filenameTemplate: string;
  /** UI §1: what happens after a capture. */
  afterCapture: 'studio' | 'pdf';
  /** UI §3 Export tab: PDF options (PDF_OUTPUT §2–5). */
  pdf: PdfSettings;
}

export interface PdfSettings {
  textLayer: boolean;
  links: boolean;
  outline: boolean;
  header: BandTemplate;
  footer: BandTemplate;
}

export const DEFAULT_PDF_SETTINGS: PdfSettings = {
  textLayer: true,
  links: true,
  outline: true,
  header: EMPTY_BAND,
  footer: DEFAULT_FOOTER,
};

/** Header/footer space is reserved only when the band has something to show. */
export function bandHeight(band: BandTemplate): number {
  return band.left.trim() || band.center.trim() || band.right.trim() ? 14 : 0;
}

export const DEFAULT_SETTINGS: Settings = {
  page: DEFAULT_PAGE_SETTINGS,
  crop: 'auto',
  breakStyle: 0.5,
  imageMode: 'auto',
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  afterCapture: 'studio',
  pdf: DEFAULT_PDF_SETTINGS,
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    page: { ...DEFAULT_SETTINGS.page, ...stored?.page },
    pdf: { ...DEFAULT_PDF_SETTINGS, ...stored?.pdf },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
