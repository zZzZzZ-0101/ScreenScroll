import {
  annotationForbidden,
  computeLayout,
  EMPTY_BAND,
  contentCrop,
  cropAround,
  confidentReading,
  findPageNumbers,
  findRunningLines,
  fitSheets,
  matchPaper,
  gridSheets,
  pageNumberAnnotations,
  paginateDebug,
  runningLineAnnotations,
  sheetSlices,
  sliderWeights,
  type Annotation,
  type FilterId,
  type PageLayout,
  type PageSlice,
  type PaginationDebug,
  type Region,
  type SheetGrid,
  type TextRun,
} from '@screenscroll/core';
import type { OcrMeta, Project } from '../../shared/db';
import { bandHeight, type Settings } from '../../shared/settings';
import type { Analysis } from './analysis';
import type { LoadedSession } from './session';

/** Breaks the user pinned or removed in the Breaks view. */
export interface Edits {
  pinned: number[];
  removed: number[];
}

export const NO_EDITS: Edits = { pinned: [], removed: [] };

export type PageResult =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Pages follow a document viewer's own pages. */
      sheets: boolean;
      /** "As the original": the matched paper's name (no margins or page labels), or null. */
      original?: string | null;
      crop: { x0: number; x1: number; cropped: boolean };
      layout: PageLayout;
      debug: PaginationDebug;
    };

/**
 * What a capture's pages are made from when document pages are found:
 * - original: everything that was captured, nothing cut (the default: detection is a hint);
 * - auto: the detected document pages;
 * - grid: document pages set or adjusted by hand.
 */
export type PagesMode = 'original' | 'auto' | 'grid';

export function pagesMode(
  project: { pages?: PagesMode; sheetGrid?: SheetGrid | null },
  settings: Pick<Settings, 'autoSheets'>,
): PagesMode {
  if (project.pages === 'grid' && !project.sheetGrid) return 'auto';
  return project.pages ?? (project.sheetGrid ? 'grid' : settings.autoSheets ? 'auto' : 'original');
}

/**
 * The pages of one capture: side crop, page layout and breaks (smart breaks, or a document
 * viewer's own pages). Shared by the Studio and merged exports, so a capture paginates the
 * same wherever it is saved.
 */
export function planPages(
  session: LoadedSession,
  analysis: Analysis,
  settings: Settings,
  project: {
    crop: Region | null;
    annotations: readonly Annotation[];
    edits?: Edits;
    sheetGrid?: SheetGrid | null;
    pages?: PagesMode;
  },
  edits?: Edits,
): PageResult {
  const { annotations } = project;
  const activeEdits = edits ?? project.edits ?? NO_EDITS;
  const mode = pagesMode(project, settings);
  // Only a reliable finding counts: weak readings exist on many ordinary pages.
  const docFound = !!(analysis.sheets || confidentReading(analysis.readings));
  // A crop drawn in the Annotate view wins over automatic side cropping. "Everything I
  // captured" on a document capture means exactly that: no side crop either.
  const manual = project.crop;
  const crop = manual
    ? { x0: manual.x0, x1: manual.x1, cropped: true }
    : settings.crop === 'auto' && !(docFound && mode === 'original')
      ? cropAround(
          contentCrop(session.width, { rows: analysis.rows, hints: session.hints }),
          annotations,
          session.width,
        )
      : { x0: 0, x1: session.width, cropped: false };
  // Header/footer space only when the band shows something (PDF_OUTPUT §4).
  const page = {
    ...settings.page,
    headerPt: bandHeight(settings.pdf.header),
    footerPt: bandHeight(settings.pdf.footer),
  };
  // A document viewer: its own pages decide, one PDF page per sheet (a drawn crop wins).
  // Pages set by hand win over detected ones and apply even when nothing was detected.
  const grid =
    mode === 'grid' && project.sheetGrid ? gridSheets(project.sheetGrid, session.height) : null;
  const sheets =
    mode === 'original'
      ? null
      : (grid ?? analysis.sheets ?? confidentReading(analysis.readings)?.layout ?? null);
  if (sheets && !manual) {
    try {
      // As the original: the page's own paper, edge to edge, without our page labels.
      const hs = sheets.sheets.map((s) => s.y1 - s.y0).sort((a, b) => a - b);
      const whole = hs.length > 2 ? hs.slice(1, -1) : hs;
      const matched = settings.docOriginal
        ? matchPaper(whole[whole.length >> 1]! / (sheets.x1 - sheets.x0))
        : null;
      const docPage = matched
        ? {
            ...page,
            paper: matched.paper,
            orientation: matched.orientation,
            marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
            headerPt: 0,
            footerPt: 0,
          }
        : page;
      const layout = fitSheets(computeLayout(docPage, sheets.x1 - sheets.x0), sheets);
      const slices = sheetSlices(sheets);
      return {
        ok: true,
        sheets: true,
        original: matched?.name ?? null,
        crop: { x0: sheets.x0, x1: sheets.x1, cropped: true },
        layout,
        debug: { slices, candidates: [], forbidden: [], opaque: [] },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  let layout: PageLayout;
  try {
    layout = computeLayout(page, crop.x1 - crop.x0);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const debug: PaginationDebug = paginateDebug({
    height: session.height,
    width: session.width,
    T: layout.T,
    hints: {
      ...session.hints,
      forbidden: [...session.hints.forbidden, ...annotationForbidden(annotations)],
    },
    rows: analysis.rows,
    crop,
    range: manual ? { y0: manual.y0, y1: manual.y1 } : undefined,
    trimBlankEnd: true,
    options: { ...sliderWeights(settings.breakStyle), ...activeEdits },
  });
  if (!debug.slices.length)
    return { ok: false, error: 'Nothing to show: the captured area is empty.' };
  return { ok: true, sheets: false, crop, layout, debug };
}

/**
 * Whether `session.ocrMeta` validly covers `slices` (order-independent min/max y range)
 * for `filter` and at least `pageCount` OCR pages.
 */
export function hasValidCachedOcr(
  session: { height: number; ocrMeta?: OcrMeta },
  slices: readonly PageSlice[],
  filter: FilterId,
  pageCount = 0,
): boolean {
  const m = session.ocrMeta;
  if (!m || m.filter !== filter || m.count < pageCount) return false;
  let y0 = 0;
  let y1 = session.height;
  if (slices.length > 0) {
    y0 = slices[0]!.y0;
    y1 = slices[0]!.y1;
    for (let i = 1; i < slices.length; i++) {
      const sl = slices[i]!;
      if (sl.y0 < y0) y0 = sl.y0;
      if (sl.y1 > y1) y1 = sl.y1;
    }
  }
  return m.y0 <= y0 + 1 && m.y1 >= y1 - 1;
}

/**
 * Every text run known for the capture: DOM text plus valid cached OCR text.
 * When `opts.filter` and `opts.slices` are given, cached OCR runs are included only if
 * `hasValidCachedOcr` holds, so stale runs after a filter or range change never leak in.
 */
export function allTextRuns(
  session: Pick<LoadedSession, 'hints'> & {
    height?: number;
    ocrRuns?: readonly TextRun[];
    ocrMeta?: OcrMeta;
  },
  opts?: { slices?: readonly PageSlice[]; filter?: FilterId; ocrPageCount?: number },
): TextRun[] {
  if (!session.ocrRuns?.length) return [...session.hints.textRuns];
  if (opts?.filter !== undefined && opts.slices !== undefined) {
    if (
      !hasValidCachedOcr(
        { height: session.height ?? 0, ocrMeta: session.ocrMeta },
        opts.slices,
        opts.filter,
        opts.ocrPageCount ?? 0,
      )
    ) {
      return [...session.hints.textRuns];
    }
  }
  return [...session.hints.textRuns, ...session.ocrRuns];
}

/**
 * Annotations drawn and redacted on export: the user's own marks, plus any derived covers
 * and renumbering for a document's own page numbers and running headers/footers.
 */
export function effectiveAnnotations(
  session: Pick<LoadedSession, 'hints'> & {
    height?: number;
    ocrRuns?: readonly TextRun[];
    ocrMeta?: OcrMeta;
  },
  result: PageResult | null,
  project: Pick<Project, 'annotations' | 'pageNumbers'>,
  filter?: FilterId,
): Annotation[] {
  if (!result?.ok || !result.sheets) return [...project.annotations];
  const slices = result.debug.slices;
  const runs = allTextRuns(session, filter !== undefined ? { slices, filter } : undefined);
  const numbers = findPageNumbers(slices, runs);
  const running = findRunningLines(slices, runs);
  return [
    ...project.annotations,
    ...pageNumberAnnotations(numbers, project.pageNumbers, slices.length),
    ...runningLineAnnotations(running, project.pageNumbers?.hideRunning),
  ];
}

/** PDF settings for these pages: "as the original" leaves our page labels out. */
export function pdfFor(settings: Settings, result: PageResult | null): Settings['pdf'] {
  return result?.ok && result.original
    ? { ...settings.pdf, header: EMPTY_BAND, footer: EMPTY_BAND }
    : settings.pdf;
}

export interface PageSelection {
  activeSlices: PageSlice[];
  /** 0-based original slice indices of active (included) pages, in display/export order. */
  activeIndices: number[];
  /** 0-based original slice indices of all pages (active + excluded), in display order. */
  orderedIndices: number[];
  /** 0-based original slice indices currently excluded. */
  excludedSet: Set<number>;
  totalSlices: number;
}

/**
 * Applies reversible per-page exclusion and ordering from `project` to `slices`.
 * - Out-of-range, non-integer, and duplicate indices are ignored safely.
 * - Any remaining original indices (e.g. after re-pagination adds pages) are appended in order.
 * - When `slices.length > 0`, at least one page always stays active (falling back to `orderedIndices[0]`).
 */
export function applyPageSelection(
  slices: readonly PageSlice[],
  project: Pick<Project, 'excludedPages' | 'pageOrder'>,
): PageSelection {
  const totalSlices = slices.length;
  if (totalSlices === 0) {
    return {
      activeSlices: [],
      activeIndices: [],
      orderedIndices: [],
      excludedSet: new Set(),
      totalSlices: 0,
    };
  }
  const seen = new Set<number>();
  const orderedIndices: number[] = [];
  for (const idx of project.pageOrder ?? []) {
    if (Number.isInteger(idx) && idx >= 0 && idx < totalSlices && !seen.has(idx)) {
      seen.add(idx);
      orderedIndices.push(idx);
    }
  }
  for (let i = 0; i < totalSlices; i++) {
    if (!seen.has(i)) orderedIndices.push(i);
  }
  const excludedSet = new Set<number>();
  for (const idx of project.excludedPages ?? []) {
    if (Number.isInteger(idx) && idx >= 0 && idx < totalSlices) {
      excludedSet.add(idx);
    }
  }
  const activeIndices = orderedIndices.filter((i) => !excludedSet.has(i));
  if (activeIndices.length === 0) {
    const first = orderedIndices[0]!;
    excludedSet.delete(first);
    activeIndices.push(first);
  }
  const activeSlices = activeIndices.map((i) => slices[i]!);
  return { activeSlices, activeIndices, orderedIndices, excludedSet, totalSlices };
}

/** True when `orderedIndices` is the natural `[0, 1, ..., n - 1]` order. */
export function isNaturalOrder(orderedIndices: readonly number[]): boolean {
  return orderedIndices.every((idx, pos) => idx === pos);
}
