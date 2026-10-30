import {
  annotationForbidden,
  computeLayout,
  contentCrop,
  cropAround,
  fitSheets,
  paginateDebug,
  sheetSlices,
  sliderWeights,
  type Annotation,
  type PageLayout,
  type PaginationDebug,
  type Region,
} from '@screenscroll/core';
import { bandHeight, type Settings } from '@/shared/settings';
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
      crop: { x0: number; x1: number; cropped: boolean };
      layout: PageLayout;
      debug: PaginationDebug;
    };

/**
 * The pages of one capture: side crop, page layout and breaks (smart breaks, or a document
 * viewer's own pages). Shared by the Studio and merged exports, so a capture paginates the
 * same wherever it is saved.
 */
export function planPages(
  session: LoadedSession,
  analysis: Analysis,
  settings: Settings,
  project: { crop: Region | null; annotations: readonly Annotation[] },
  edits: Edits = NO_EDITS,
): PageResult {
  const { annotations } = project;
  // A crop drawn in the Annotate view wins over automatic side cropping.
  const manual = project.crop;
  const crop = manual
    ? { x0: manual.x0, x1: manual.x1, cropped: true }
    : settings.crop === 'auto'
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
  const sheets = analysis.sheets;
  if (sheets && settings.followSheets && !manual) {
    try {
      const layout = fitSheets(computeLayout(page, sheets.x1 - sheets.x0), sheets);
      const slices = sheetSlices(sheets);
      return {
        ok: true,
        sheets: true,
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
    options: { ...sliderWeights(settings.breakStyle), ...edits },
  });
  if (!debug.slices.length)
    return { ok: false, error: 'Nothing to show: the captured area is empty.' };
  return { ok: true, sheets: false, crop, layout, debug };
}
