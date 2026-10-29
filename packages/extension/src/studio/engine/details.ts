import {
  FILTERS,
  PAPERS,
  PT_PER_MM,
  QUALITY,
  exportScale,
  imagePx,
  medianFontPx,
  pageDpi,
  sliderWeights,
  watermarkOn,
  type PageLayout,
  type PageSlice,
} from '@screenscroll/core';
import { DEFAULT_ENGINE, MIN_CONFIDENCE } from '@screenscroll/core/ocr';
import { RESOLUTION_SCALE, SPEED_TIMING, type Settings } from '../../shared/settings';
import type { LoadedSession } from './session';

/**
 * The Details panel: every number behind the pages, with how it was worked out. One row is
 * a label, a value, and (when it is calculated) the calculation with the actual numbers.
 */
export interface Row {
  label: string;
  value: string;
  how?: string;
}
export interface Section {
  title: string;
  rows: Row[];
}
export interface PageRow {
  n: number;
  y0: number;
  y1: number;
  height: number;
  /** Share of the page's content height used. */
  fill: number;
  breakKind: string;
  cost: number;
  overlap: number;
  imageW: number;
  imageH: number;
  warnings: number;
}
export interface Details {
  sections: Section[];
  pages: PageRow[];
}

export interface DetailsInput {
  session: LoadedSession;
  settings: Settings;
  layout: PageLayout;
  crop: { x0: number; x1: number; cropped: boolean };
  slices: PageSlice[];
  /** Pages follow a document viewer's own pages. */
  sheets: boolean;
  estimate: number | null;
  /** Pages (0-based) text recognition will read, and whether its model is here. */
  ocr: { pages: number[]; ready: boolean };
}

const f = (v: number, d = 1) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : '–';
const px = (v: number) => `${f(v, 0)} px`;
const pt = (v: number) => `${f(v)} pt`;
const on = (b: boolean) => (b ? 'on' : 'off');
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${f(n / 1024, 0)} KB`;
  return `${f(n / 1048576, 1)} MB`;
}

export function buildDetails(i: DetailsInput): Details {
  const { session: s, settings: st, layout: L, crop, slices } = i;
  const rec = s.session;
  const width = crop.x1 - crop.x0;
  const paperName = typeof st.page.paper === 'string' ? st.page.paper : 'Custom';
  const paperMm =
    typeof st.page.paper === 'string'
      ? PAPERS[st.page.paper]
      : (st.page.paper as { w: number; h: number });
  const m = st.page.marginsMm;
  const dpi = pageDpi(s.dpr, L.s);
  const spec = QUALITY[st.exportPreset];
  const scale = exportScale(s.dpr, L.s, spec);
  const outDpi = dpi * scale;
  const fontPx = medianFontPx(s.hints.textRuns.map((t) => t.fontSizePx));
  const filter = FILTERS.find((x) => x.id === st.pdf.filter) ?? FILTERS[0]!;
  const weights = sliderWeights(st.breakStyle);
  const timing = SPEED_TIMING[st.capture.speed];
  const forced = slices.filter((sl) => sl.overlapTop > 0).length;
  const wm = st.pdf.watermark;
  const wmPages = wm.text.trim()
    ? slices.map((_, k) => k + 1).filter((n) => watermarkOn(wm, n, slices.length))
    : [];
  const band = (b: { left: string; center: string; right: string }) =>
    [b.left, b.center, b.right].filter((t) => t.trim()).join(' | ') || 'none';

  const sections: Section[] = [
    {
      title: 'Capture',
      rows: [
        { label: 'Page', value: rec.title || '(no title)' },
        { label: 'Address', value: rec.url },
        { label: 'Captured', value: new Date(rec.capturedAt).toLocaleString() },
        { label: 'Status', value: rec.status },
        { label: 'Frames', value: String(s.frames.length) },
        {
          label: 'Device px per CSS px',
          value: f(s.dpr, 2),
          how: 'frame image width ÷ viewport width (browser zoom and Sharpness included)',
        },
        {
          label: 'Captured area',
          value: `${px(s.width)} × ${px(s.height)}`,
          how: `= ${f(s.width * s.dpr, 0)} × ${f(s.height * s.dpr, 0)} image px at ${f(s.dpr, 2)}×`,
        },
        {
          label: 'Sharpness setting',
          value: `${st.capture.resolution} (${RESOLUTION_SCALE[st.capture.resolution]}×)`,
        },
        {
          label: 'Speed setting',
          value: `${st.capture.speed}: ${timing.intervalMs} ms per screen, settle ${timing.settleMs} ms`,
          how: `image wait ${timing.frameImageWaitMs} ms per screen, ${timing.pageImageWaitMs} ms for the page; the browser allows 2 screenshots/s`,
        },
        {
          label: 'Read from the page',
          value: `${f(s.hints.textRuns.length, 0)} text runs, ${f(s.hints.links.length, 0)} links, ${f(s.hints.headings.length, 0)} headings`,
        },
        { label: 'Notes', value: String(rec.warnings.length) },
      ],
    },
    {
      title: 'Page layout',
      rows: [
        {
          label: 'Paper',
          value: `${paperName} ${f(paperMm.w)} × ${f(paperMm.h)} mm, ${st.page.orientation}`,
          how: `= ${pt(L.paperW)} × ${pt(L.paperH)} (1 mm = 72 / 25.4 = ${f(PT_PER_MM, 3)} pt)`,
        },
        {
          label: 'Margins',
          value: `${f(m.top)} / ${f(m.right)} / ${f(m.bottom)} / ${f(m.left)} mm`,
          how: `= ${[m.top, m.right, m.bottom, m.left].map((v) => f(v * PT_PER_MM)).join(' / ')} pt (top / right / bottom / left)`,
        },
        {
          label: 'Header / footer bands',
          value: `${pt(st.page.headerPt)} / ${pt(st.page.footerPt)}`,
          how: 'space is kept only when the band has text',
        },
        {
          label: 'Printable box',
          value: `${pt(L.box.w)} × ${pt(L.box.h)}`,
          how: `at x ${pt(L.box.x)}, y ${pt(L.box.y)} from the top-left of the paper`,
        },
        {
          label: 'Content width',
          value: px(width),
          how: `x ${f(crop.x0, 0)} → ${f(crop.x1, 0)} of ${f(s.width, 0)} (${i.sheets ? 'document page' : crop.cropped ? 'side margins cropped' : 'full width'})`,
        },
        {
          label: 'Scale s',
          value: `${f(L.s, 4)} pt per CSS px`,
          how: `${i.sheets ? 'min(box width ÷ page width, box height ÷ tallest page)' : `box width ÷ content width = ${f(L.box.w)} ÷ ${f(width, 0)}`}${L.scaleClamped ? ' (fixed scale reduced to fit)' : ''}`,
        },
        {
          label: 'Content per page T',
          value: px(L.T),
          how: `box height ÷ s = ${f(L.box.h)} ÷ ${f(L.s, 4)}`,
        },
        {
          label: 'Body text on paper',
          value: fontPx ? pt(fontPx * L.s) : '–',
          how: fontPx ? `median text size ${f(fontPx)} px × s ${f(L.s, 4)}` : 'no text read',
        },
        {
          label: 'Image resolution on paper',
          value: `${f(dpi, 0)} dpi`,
          how: `dpr × 72 ÷ s = ${f(s.dpr, 2)} × 72 ÷ ${f(L.s, 4)}`,
        },
      ],
    },
    {
      title: 'Page breaks',
      rows: [
        {
          label: 'Method',
          value: i.sheets ? 'document pages (one PDF page each)' : 'smart breaks',
        },
        ...(i.sheets
          ? []
          : [
              {
                label: 'Break style',
                value: f(st.breakStyle, 2),
                how: `fill weight α = 2^((0.5 − c)·2) = ${f(weights.alpha, 3)}, clean-break weight β = 2^((c − 0.5)·2) = ${f(weights.beta, 3)}`,
              },
              {
                label: 'Break cost',
                value: 'α·((T − h)/T)²·100 + β·badness + 50 if h < 0.35·T',
                how: 'per page of height h (no fill term on the last page); badness at the cut: section 0, paragraph 1, list item 1.5, table row 2.5, line 4, blank 3, +6 widow/orphan, +40 heading cut from its text, +20 not confirmed by pixels; forced cut 100+; the cheapest set of breaks wins',
              },
            ]),
        { label: 'Pages', value: String(slices.length) },
        {
          label: 'Forced cuts',
          value: String(forced),
          how: forced ? 'each repeats an overlap and carries a note' : 'none: no text is cut',
        },
      ],
    },
    {
      title: 'Output',
      rows: [
        { label: 'Filter', value: filter.name, how: filter.params },
        {
          label: 'PDF quality',
          value: spec.name,
          how: `${spec.maxDpi ? `≤ ${spec.maxDpi} dpi` : 'no resolution cap'} · ${spec.format === 'png' ? 'PNG' : `PNG or JPEG ${f(spec.jpegQuality * 100, 0)} by content`}`,
        },
        {
          label: 'Image scale',
          value: f(scale, 3),
          how: spec.maxDpi
            ? `min(1, ${spec.maxDpi} ÷ ${f(dpi, 0)}) → ${f(outDpi, 0)} dpi`
            : `1 → ${f(outDpi, 0)} dpi`,
        },
        {
          label: 'Format by content',
          value: 'PNG if ≤ 1,200 colours, else JPEG',
          how: 'colours counted at 4 bits per channel on up to 20,000 sampled pixels',
        },
        {
          label: 'Estimated size',
          value: i.estimate === null ? 'working…' : bytes(i.estimate),
          how: 'first and middle page encoded, × pages',
        },
        { label: 'Searchable text', value: on(st.pdf.textLayer) },
        {
          label: 'Text recognition',
          value: `${st.ocr} · ${i.ocr.pages.length ? `pages ${i.ocr.pages.map((n) => n + 1).join(', ')}` : 'no pages'} · model ${i.ocr.ready ? 'ready' : 'not downloaded'}`,
          how: `${DEFAULT_ENGINE.name}: DB detection (threshold ${DEFAULT_ENGINE.det.threshold}, box ${DEFAULT_ENGINE.det.boxThreshold}, unclip ${DEFAULT_ENGINE.det.unclipRatio}, tiles ${DEFAULT_ENGINE.det.tileSide}/${DEFAULT_ENGINE.det.overlap} px, ×2 below 1.5 px per CSS px), CTC recognition at ${DEFAULT_ENGINE.rec.height} px high; lines under ${MIN_CONFIDENCE} confidence left out; auto = pages with < 20 characters of their own text`,
        },
        { label: 'Links', value: on(st.pdf.links) },
        { label: 'Bookmarks', value: on(st.pdf.outline) },
        { label: 'Header', value: band(st.pdf.header) },
        { label: 'Footer', value: band(st.pdf.footer) },
        {
          label: 'Watermark',
          value: wm.text.trim() ? `“${wm.text}”` : 'none',
          how: wm.text.trim()
            ? `${f(wm.sizePt)} pt, ${f(wm.angle)}°, opacity ${f(wm.opacity, 2)}, ${wm.color}, pages ${wmPages.length ? wmPages.join(', ') : 'none'}`
            : undefined,
        },
      ],
    },
  ];

  const pages: PageRow[] = slices.map((sl, k) => {
    const h = sl.y1 - sl.y0;
    const img = imagePx(sl.x1 - sl.x0, h, s.dpr, scale);
    return {
      n: k + 1,
      y0: sl.y0,
      y1: sl.y1,
      height: h,
      fill: h / L.T,
      breakKind: sl.breakKind,
      cost: sl.cost,
      overlap: sl.overlapTop,
      imageW: img.w,
      imageH: img.h,
      warnings: sl.warnings.length,
    };
  });
  return { sections, pages };
}

/** Plain text of the whole panel, for "Copy all". */
export function detailsText(d: Details): string {
  const out: string[] = [];
  for (const s of d.sections) {
    out.push(`## ${s.title}`);
    for (const r of s.rows) out.push(`${r.label}: ${r.value}${r.how ? `  (${r.how})` : ''}`);
    out.push('');
  }
  out.push('## Pages');
  out.push('#\ty0\ty1\theight\tfill\tbreak\tcost\toverlap\timage px');
  for (const p of d.pages)
    out.push(
      [
        p.n,
        f(p.y0, 0),
        f(p.y1, 0),
        f(p.height, 0),
        `${f(p.fill * 100, 0)}%`,
        p.breakKind,
        f(p.cost, 1),
        f(p.overlap, 0),
        `${p.imageW}×${p.imageH}`,
      ].join('\t'),
    );
  return out.join('\n');
}
