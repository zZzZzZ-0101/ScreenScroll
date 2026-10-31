import { EXPORT_PRESETS, FILTERS, PAPERS, QUALITY } from '@screenscroll/core';
import { DEFAULT_SETTINGS, SPEED_TIMING, type Settings } from './settings';

/**
 * Every user setting in one list: what it does in a plain sentence, its default, the value we
 * recommend and why. The Settings page is drawn from this, so a new setting is one entry.
 */
export interface Choice {
  value: string | number | boolean;
  label: string;
}

export interface SettingEntry {
  id: string;
  section: Section;
  label: string;
  help: string;
  kind: 'choice' | 'number' | 'text' | 'toggle';
  choices?: Choice[];
  min?: number;
  max?: number;
  unit?: string;
  get: (s: Settings) => string | number | boolean;
  set: (s: Settings, v: string | number | boolean) => Partial<Settings>;
  recommended: string | number | boolean;
  /** Why the recommended value, when it isn't obvious. */
  why?: string;
}

export type Section =
  'Capture' | 'Pages and PDF' | 'Text recognition' | 'Files and storage' | 'Appearance';
export const SECTIONS: Section[] = [
  'Capture',
  'Pages and PDF',
  'Text recognition',
  'Files and storage',
  'Appearance',
];

const t = SPEED_TIMING;

export const SETTINGS: SettingEntry[] = [
  {
    id: 'capture.start',
    section: 'Capture',
    label: 'Where a full-page capture starts',
    help: 'From the top of the page, or from where you have scrolled to.',
    kind: 'choice',
    choices: [
      { value: 'top', label: 'Top of the page' },
      { value: 'here', label: 'Where I am now' },
    ],
    get: (s) => s.capture.start,
    set: (s, v) => ({ capture: { ...s.capture, start: v as Settings['capture']['start'] } }),
    recommended: 'top',
  },
  {
    id: 'capture.speed',
    section: 'Capture',
    label: 'Capture speed',
    help: `Time per screen. Careful waits longer for slow pictures (${t.careful.intervalMs} ms a screen); Normal ${t.normal.intervalMs} ms; Fast ${t.fast.intervalMs} ms, the most the browser allows, and may miss pictures that load late.`,
    kind: 'choice',
    choices: [
      { value: 'careful', label: 'Careful' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'Fast' },
    ],
    get: (s) => s.capture.speed,
    set: (s, v) => ({ capture: { ...s.capture, speed: v as Settings['capture']['speed'] } }),
    recommended: 'normal',
    why: 'Fast enough for long pages, patient enough for lazy-loading images.',
  },
  {
    id: 'capture.resolution',
    section: 'Capture',
    label: 'Sharpness (resolution)',
    help: 'Standard captures the pixels your screen shows. High (2×) and Maximum (3×) render the page at a higher density first, for crisp print. The browser shows a "debugging" bar while they capture, and asks for permission once.',
    kind: 'choice',
    choices: [
      { value: 'standard', label: 'Standard' },
      { value: 'high', label: 'High (2×)' },
      { value: 'max', label: 'Maximum (3×)' },
    ],
    get: (s) => s.capture.resolution,
    set: (s, v) => ({
      capture: { ...s.capture, resolution: v as Settings['capture']['resolution'] },
    }),
    recommended: 'high',
    why: 'Small print stays sharp on paper; files grow about 2–4×.',
  },
  {
    id: 'capture.width',
    section: 'Capture',
    label: 'Page width',
    help: 'Wide pages shrink their text to fit the paper. With a width set, a whole-page capture first makes the window narrower so the page lays itself out at that width, then puts the window back as it was. Pages already narrower are left alone.',
    kind: 'choice',
    choices: [
      { value: '0', label: 'As it is' },
      { value: '1000', label: '1000 px' },
      { value: '1200', label: '1200 px' },
      { value: '1440', label: '1440 px' },
    ],
    get: (s) => String(s.capture.width),
    set: (s, v) => ({
      capture: { ...s.capture, width: Number(v) as Settings['capture']['width'] },
    }),
    recommended: '1000',
    why: 'On A4 portrait with 10 mm margins (190 mm = 539 pt across), 16 px text prints at 16 × 539 ÷ width: 8.6 pt at 1000 px, 7.2 pt at 1200 px, 6.0 pt at 1440 px. Books use 9–11 pt.',
  },
  {
    id: 'afterCapture',
    section: 'Capture',
    label: 'After a capture',
    help: 'Open the Studio to check the pages, or save the PDF straight away with automatic breaks.',
    kind: 'choice',
    choices: [
      { value: 'studio', label: 'Review in the Studio' },
      { value: 'pdf', label: 'Save the PDF' },
    ],
    get: (s) => s.afterCapture,
    set: (_s, v) => ({ afterCapture: v as Settings['afterCapture'] }),
    recommended: 'studio',
  },
  {
    id: 'page.paper',
    section: 'Pages and PDF',
    label: 'Paper',
    help: 'Page size of the PDF.',
    kind: 'choice',
    choices: Object.keys(PAPERS).map((p) => ({ value: p, label: p })),
    get: (s) => (typeof s.page.paper === 'string' ? s.page.paper : 'A4'),
    set: (s, v) => ({ page: { ...s.page, paper: v as keyof typeof PAPERS } }),
    recommended: 'A4',
    why: 'Letter in the US and Canada.',
  },
  {
    id: 'page.orientation',
    section: 'Pages and PDF',
    label: 'Orientation',
    help: 'Landscape suits wide pages and tables.',
    kind: 'choice',
    choices: [
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    get: (s) => s.page.orientation,
    set: (s, v) => ({ page: { ...s.page, orientation: v as 'portrait' | 'landscape' } }),
    recommended: 'portrait',
  },
  {
    id: 'page.margins',
    section: 'Pages and PDF',
    label: 'Margins',
    help: 'Space around the content on every page.',
    kind: 'number',
    min: 0,
    max: 40,
    unit: 'mm',
    get: (s) => s.page.marginsMm.top,
    set: (s, v) => {
      const m = Math.max(0, Math.min(40, Number(v) || 0));
      return { page: { ...s.page, marginsMm: { top: m, right: m, bottom: m, left: m } } };
    },
    recommended: 10,
  },
  {
    id: 'breakStyle',
    section: 'Pages and PDF',
    label: 'Page breaks',
    help: 'Fewer pages fills each page fully; cleaner breaks prefers the end of a section or paragraph.',
    kind: 'choice',
    choices: [
      { value: 0.15, label: 'Fewer pages' },
      { value: 0.5, label: 'Balanced' },
      { value: 0.85, label: 'Cleaner breaks' },
    ],
    get: (s) => s.breakStyle,
    set: (_s, v) => ({ breakStyle: Number(v) }),
    recommended: 0.5,
  },
  {
    id: 'followSheets',
    section: 'Pages and PDF',
    label: 'Document viewers: one PDF page per document page',
    help: 'In Google Drive, Docs, Office or PDF previews, keep the document’s own pages, cropped, instead of choosing new breaks.',
    kind: 'toggle',
    get: (s) => s.followSheets,
    set: (_s, v) => ({ followSheets: !!v }),
    recommended: true,
  },
  {
    id: 'exportPreset',
    section: 'Pages and PDF',
    label: 'PDF quality',
    help: EXPORT_PRESETS.map((q) => `${QUALITY[q].name}: ${QUALITY[q].summary}`).join(' '),
    kind: 'choice',
    choices: EXPORT_PRESETS.map((q) => ({ value: q, label: QUALITY[q].name })),
    get: (s) => s.exportPreset,
    set: (_s, v) => ({ exportPreset: v as Settings['exportPreset'] }),
    recommended: 'balanced',
    why: '300 dpi is what printers resolve; more only makes the file bigger. Best or Lossless to keep every captured pixel.',
  },
  {
    id: 'pdf.filter',
    section: 'Pages and PDF',
    label: 'Filter',
    help: FILTERS.map((f) => `${f.name}: ${f.short.toLowerCase()}.`).join(' '),
    kind: 'choice',
    choices: FILTERS.map((f) => ({ value: f.id, label: f.name })),
    get: (s) => s.pdf.filter,
    set: (s, v) => ({ pdf: { ...s.pdf, filter: v as Settings['pdf']['filter'] } }),
    recommended: 'original',
    why: 'Keeps the page as you saw it. Black & white for printing text; Ink saver for dark pages.',
  },
  {
    id: 'pdf.textLayer',
    section: 'Pages and PDF',
    label: 'Searchable text',
    help: 'Invisible text under the images, so the PDF can be searched and copied.',
    kind: 'toggle',
    get: (s) => s.pdf.textLayer,
    set: (s, v) => ({ pdf: { ...s.pdf, textLayer: !!v } }),
    recommended: true,
  },
  {
    id: 'pdf.links',
    section: 'Pages and PDF',
    label: 'Clickable links',
    help: 'Links on the page stay clickable in the PDF.',
    kind: 'toggle',
    get: (s) => s.pdf.links,
    set: (s, v) => ({ pdf: { ...s.pdf, links: !!v } }),
    recommended: true,
  },
  {
    id: 'pdf.outline',
    section: 'Pages and PDF',
    label: 'Bookmarks from headings',
    help: 'The page’s headings become the PDF’s bookmarks.',
    kind: 'toggle',
    get: (s) => s.pdf.outline,
    set: (s, v) => ({ pdf: { ...s.pdf, outline: !!v } }),
    recommended: true,
  },
  {
    id: 'ocr',
    section: 'Text recognition',
    label: 'Recognise text in pictures (OCR)',
    help: 'Reads text that is only a picture (document previews, canvas, scanned pages) so the PDF can be searched and copied there too. Runs on this computer; nothing is uploaded. Needs the model below, downloaded once.',
    kind: 'choice',
    choices: [
      { value: 'auto', label: 'Where needed' },
      { value: 'always', label: 'Everywhere' },
      { value: 'off', label: 'Off' },
    ],
    get: (s) => s.ocr,
    set: (_s, v) => ({ ocr: v as Settings['ocr'] }),
    recommended: 'auto',
    why: 'Pages with real text already have it exactly; recognising it again only adds time.',
  },
  {
    id: 'filenameTemplate',
    section: 'Files and storage',
    label: 'File name',
    help: 'Tokens: {title} {domain} {date} {time} {url}.',
    kind: 'text',
    get: (s) => s.filenameTemplate,
    set: (_s, v) => ({ filenameTemplate: String(v) }),
    recommended: DEFAULT_SETTINGS.filenameTemplate,
  },
  {
    id: 'keepDays',
    section: 'Files and storage',
    label: 'Keep saved captures',
    help: 'Older captures are deleted automatically. Saved PDFs in your Downloads folder are not affected.',
    kind: 'choice',
    choices: [
      { value: 0, label: 'Until I delete them' },
      { value: 7, label: '7 days' },
      { value: 30, label: '30 days' },
      { value: 90, label: '90 days' },
    ],
    get: (s) => s.keepDays,
    set: (_s, v) => ({ keepDays: Number(v) }),
    recommended: 90,
    why: 'Long enough to re-export, short enough not to fill the disk.',
  },
  {
    id: 'language',
    section: 'Appearance',
    label: 'Language',
    help: 'The language of ScreenScroll itself. Auto follows the browser.',
    kind: 'choice',
    choices: [
      { value: 'auto', label: 'Auto' },
      { value: 'en', label: 'English' },
      { value: 'zh-CN', label: '简体中文' },
    ],
    get: (s) => s.language,
    set: (_s, v) => ({ language: v as Settings['language'] }),
    recommended: 'auto',
  },
  {
    id: 'theme',
    section: 'Appearance',
    label: 'Theme',
    help: 'Light, dark, or the same as your system.',
    kind: 'choice',
    choices: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    get: (s) => s.theme,
    set: (_s, v) => ({ theme: v as Settings['theme'] }),
    recommended: 'system',
  },
];

export const defaultOf = (e: SettingEntry) => e.get(DEFAULT_SETTINGS);
export const labelOf = (e: SettingEntry, v: string | number | boolean) =>
  e.kind === 'toggle'
    ? v
      ? 'On'
      : 'Off'
    : (e.choices?.find((c) => c.value === v)?.label ?? `${v}${e.unit ? ` ${e.unit}` : ''}`);
