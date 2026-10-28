import {
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_FOOTER,
  DEFAULT_PAGE_SETTINGS,
  EMPTY_BAND,
  PAPERS,
  type BandTemplate,
  type PageSettings,
} from '@screenscroll/core';

/** PDF page images: chosen per page by content, or forced. */
export type ImageMode = 'auto' | 'png' | 'jpeg';

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
  /** Saved captures older than this many days are deleted; 0 keeps them until deleted. */
  keepDays: number;
  /** In a document viewer (Drive, PDF previews), one PDF page per document page. */
  followSheets: boolean;
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
  keepDays: 0,
  followSheets: true,
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings((await chrome.storage.local.get(KEY))[KEY]);
}

/**
 * Stored settings come from older versions, other devices' sync or hand edits: keep each
 * field only if it is valid, so one bad value never breaks the Studio.
 */
export function normalizeSettings(stored: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const o = isObject(stored) ? stored : {};
  const page = isObject(o.page) ? o.page : {};
  const pdf = isObject(o.pdf) ? o.pdf : {};
  const margins = isObject(page.marginsMm) ? page.marginsMm : {};
  const mm = (v: unknown, def: number) => (num(v) && v >= 0 && v <= 100 ? v : def);
  const paper = page.paper;
  const validPaper =
    (typeof paper === 'string' && paper in PAPERS) ||
    (isObject(paper) && num(paper.w) && num(paper.h) && paper.w > 10 && paper.h > 10);
  return {
    page: {
      paper: validPaper ? (paper as PageSettings['paper']) : d.page.paper,
      orientation: page.orientation === 'landscape' ? 'landscape' : 'portrait',
      marginsMm: {
        top: mm(margins.top, d.page.marginsMm.top),
        right: mm(margins.right, d.page.marginsMm.right),
        bottom: mm(margins.bottom, d.page.marginsMm.bottom),
        left: mm(margins.left, d.page.marginsMm.left),
      },
      headerPt: d.page.headerPt,
      footerPt: d.page.footerPt,
      scale:
        page.scale === 'fit' || (num(page.scale) && page.scale >= 10 && page.scale <= 400)
          ? (page.scale as PageSettings['scale'])
          : d.page.scale,
    },
    crop: o.crop === 'off' ? 'off' : 'auto',
    breakStyle: num(o.breakStyle) ? Math.max(0, Math.min(1, o.breakStyle)) : d.breakStyle,
    imageMode: o.imageMode === 'png' || o.imageMode === 'jpeg' ? o.imageMode : 'auto',
    filenameTemplate:
      typeof o.filenameTemplate === 'string' ? o.filenameTemplate : d.filenameTemplate,
    afterCapture: o.afterCapture === 'pdf' ? 'pdf' : 'studio',
    followSheets: o.followSheets !== false,
    keepDays: num(o.keepDays) && o.keepDays >= 0 && o.keepDays <= 3650 ? Math.round(o.keepDays) : 0,
    pdf: {
      textLayer: typeof pdf.textLayer === 'boolean' ? pdf.textLayer : d.pdf.textLayer,
      links: typeof pdf.links === 'boolean' ? pdf.links : d.pdf.links,
      outline: typeof pdf.outline === 'boolean' ? pdf.outline : d.pdf.outline,
      header: band(pdf.header, d.pdf.header),
      footer: band(pdf.footer, d.pdf.footer),
    },
  };
}

function band(v: unknown, def: BandTemplate): BandTemplate {
  if (!isObject(v)) return def;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return { left: str(v.left), center: str(v.center), right: str(v.right) };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
