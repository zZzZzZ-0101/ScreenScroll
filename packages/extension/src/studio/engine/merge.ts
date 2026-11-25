import { parsePageList, type PageSlice } from '@screenscroll/core';
import { pagesNeedingOcr, type OcrMode } from '@screenscroll/core/ocr';
import { buildMergedPdf, type PageImage, type PdfPart } from '@screenscroll/core/pdf';
import type { Settings } from '@/shared/settings';
import { analyze } from './analysis';
import {
  contentOf,
  hasCachedOcr,
  metaOf,
  pageImages,
  pdfOptions,
  type PageOcr,
  type Progress,
} from './export';
import { effectiveAnnotations, planPages } from './plan';
import { FrameCache, loadSession } from './session';

/** One capture in a merge: which pages, as "all" or a list like "1-3, 5". */
export interface MergeItem {
  id: string;
  pages: string;
}

/** Pages to take from a capture of `count` pages; empty or "all" means every page. */
export function pickPages(spec: string, count: number): number[] {
  const t = spec.trim().toLowerCase();
  if (!t || t === 'all') return Array.from({ length: count }, (_, i) => i + 1);
  return parsePageList(t, count);
}

export interface MergeResult {
  bytes: Uint8Array;
  pages: number;
  title: string;
}

async function* withFrameCleanup(
  gen: AsyncIterable<PageImage>,
  frames: FrameCache,
): AsyncGenerator<PageImage> {
  try {
    yield* gen;
  } finally {
    frames.clear();
  }
}

/**
 * Several captures in one PDF (UI §5): each paginated exactly as the Studio would (its crop,
 * marks, break edits and document pages), on the same paper (L12), page numbers running
 * across the whole document, one bookmark per capture.
 */
export async function exportMerged(
  items: readonly MergeItem[],
  settings: Settings,
  onProgress?: (stage: string, done: number, total: number) => void,
  /** Text recognition when its model is here: pages without text of their own are read. */
  ocr?: { mode: OcrMode; read: PageOcr['read'] },
): Promise<MergeResult> {
  if (!items.length) throw new Error('Nothing to merge.');
  const parts: PdfPart[] = [];
  const titles: string[] = [];
  const caches: FrameCache[] = [];
  try {
    for (const [k, item] of items.entries()) {
      onProgress?.('Reading', k, items.length);
      const raw = await loadSession(item.id);
      const frames = new FrameCache(raw.frames);
      caches.push(frames);
      const a = await analyze(raw, frames, undefined, {
        buildStrip: false,
        alignSeams: !raw.project.rawSeams,
      });
      const s = { ...raw, geoms: a.geoms, height: a.height };
      const plan = planPages(s, a, settings, s.project);
      const name = s.session.title || s.session.url;
      if (!plan.ok) throw new Error(`${name}: ${plan.error}`);
      const all = plan.debug.slices;
      const picked = pickPages(item.pages, all.length);
      if (!picked.length) throw new Error(`${name}: no pages match “${item.pages}”.`);
      const slices: PageSlice[] = picked.map((n) => all[n - 1]!);
      const anns = effectiveAnnotations(s, plan, s.project);
      const needed = ocr ? pagesNeedingOcr(ocr.mode, slices, s.hints.textRuns) : [];
      const cached =
        needed.length > 0 && hasCachedOcr(s, slices, settings.pdf.filter, needed.length);
      const progress: Progress = (done, total) => onProgress?.(`Capture ${k + 1}`, done, total);
      parts.push({
        pages: withFrameCleanup(
          pageImages(
            s,
            frames,
            slices,
            plan.layout,
            settings.exportPreset,
            progress,
            anns,
            settings.pdf.filter,
            ocr && needed.length && !cached
              ? { pages: new Set(needed), read: ocr.read }
              : undefined,
          ),
          frames,
        ),
        pageCount: slices.length,
        layout: plan.layout,
        meta: metaOf(s),
        content: contentOf(s, anns, cached),
      });
      titles.push(name);
    }
    const title = titles.length === 1 ? titles[0]! : `${titles[0]} and ${titles.length - 1} more`;
    const meta = { title, url: parts[0]!.meta.url, capturedAt: new Date() };
    const bytes = await buildMergedPdf(parts, meta, pdfOptions(settings.pdf));
    return { bytes, pages: parts.reduce((n, p) => n + p.pageCount, 0), title };
  } finally {
    for (const f of caches) f.clear();
  }
}
