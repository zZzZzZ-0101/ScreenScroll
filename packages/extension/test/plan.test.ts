import {
  DEFAULT_STYLE,
  emptyHints,
  RowAnalyzer,
  type PageSlice,
  type TextRun,
} from '@screenscroll/core';
import { describe, expect, it } from 'vitest';
import { summarizeFrames, type OcrMeta, type Project } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import {
  _resetAnalysisWorkerForTest,
  filterPixelsAsync,
  type Analysis,
} from '../src/studio/engine/analysis';
import { contentOf, hasCachedOcr } from '../src/studio/engine/export';
import {
  allTextRuns,
  applyPageSelection,
  effectiveAnnotations,
  hasValidCachedOcr,
  isNaturalOrder,
  planPages,
} from '../src/studio/engine/plan';
import type { LoadedSession } from '../src/studio/engine/session';

function makeAnalysis(width: number, height: number): Analysis {
  const analyzer = new RowAnalyzer(width, 1);
  const data = new Uint8Array(width * height).fill(255);
  analyzer.push({ width, height, data });
  return {
    rows: analyzer.finish(),
    strip: [],
    stripScale: 1,
    sheets: null,
    readings: [],
    evidence: null,
    geoms: [],
    height,
    seams: [],
    adjustedSeamPx: 0,
    unverifiedSeams: 0,
    seamAdjusted: false,
    seamWarnings: [],
  };
}

function makeSession(
  width: number,
  height: number,
  textRuns: TextRun[] = [],
  ocrRuns: TextRun[] = [],
  ocrMeta?: OcrMeta,
): LoadedSession {
  return {
    session: {
      id: 's1',
      url: 'https://example.org/doc',
      title: 'Doc',
      capturedAt: '2026-11-25T00:00:00Z',
      status: 'complete',
      docWidth: width,
      docHeight: height,
      frameCount: 2,
      warnings: [],
      tabId: 1,
      windowId: 1,
    },
    frames: [],
    geoms: [],
    hints: {
      ...emptyHints(),
      blockEnds: [
        { y: 400, kind: 'paragraph' },
        { y: 700, kind: 'paragraph' },
        { y: 1000, kind: 'paragraph' },
      ],
      textRuns,
    },
    ocrRuns,
    ocrMeta,
    width,
    height,
    dpr: 1,
    project: { annotations: [], crop: null },
  };
}

describe('planPages and effectiveAnnotations', () => {
  it('honours manual break edits stored in project.edits', () => {
    const s = makeSession(800, 1600);
    const a = makeAnalysis(800, 1600);
    const auto = planPages(s, a, DEFAULT_SETTINGS, { annotations: [], crop: null });
    expect(auto.ok).toBe(true);
    if (!auto.ok) return;

    const withPinned = planPages(s, a, DEFAULT_SETTINGS, {
      annotations: [],
      crop: null,
      edits: { pinned: [400], removed: [] },
    });
    expect(withPinned.ok).toBe(true);
    if (!withPinned.ok) return;
    expect(withPinned.debug.slices[0]!.y1).toBe(400);
    expect(withPinned.debug.slices[0]!.breakKind).toBe('manual');
  });

  it('includes derived page-number and running-header covers on document sheets', () => {
    const runs: TextRun[] = [
      // Running header at top of both sheets
      {
        text: 'Confidential Handout',
        rect: { x: 100, y: 30, width: 200, height: 16 },
        fontSizePx: 12,
      },
      {
        text: 'Confidential Handout',
        rect: { x: 100, y: 1050, width: 200, height: 16 },
        fontSizePx: 12,
      },
      // Sequential page numbers at bottom of both sheets (5 and 6)
      { text: 'Page 5 of 10', rect: { x: 350, y: 960, width: 80, height: 16 }, fontSizePx: 12 },
      { text: 'Page 6 of 10', rect: { x: 350, y: 1980, width: 80, height: 16 }, fontSizePx: 12 },
    ];
    const s = makeSession(800, 2040, runs);
    const a: Analysis = {
      ...makeAnalysis(800, 2040),
      sheets: {
        x0: 40,
        x1: 760,
        sheets: [
          { y0: 10, y1: 1000 },
          { y0: 1030, y1: 2020 },
        ],
      },
    };
    const project: Project = {
      annotations: [],
      crop: null,
      pages: 'auto',
      pageNumbers: { renumber: true, hideRunning: true },
    };
    const res = planPages(s, a, DEFAULT_SETTINGS, project);
    expect(res.ok && res.sheets).toBe(true);
    const anns = effectiveAnnotations(s, res, project);
    // 2 page-number covers + 2 renumbered text labels + 2 running-header covers = 6
    expect(anns.filter((x) => x.kind === 'cover')).toHaveLength(4);
    expect(
      anns.filter((x) => x.kind === 'text').map((x) => (x.kind === 'text' ? x.text : '')),
    ).toEqual(['Page 1 of 2', 'Page 2 of 2']);

    // When switched back to "Everything I captured" (sheets: false), derived covers disappear.
    const orig = planPages(s, a, DEFAULT_SETTINGS, { ...project, pages: 'original' });
    expect(effectiveAnnotations(s, orig, project)).toEqual([]);
  });

  it('finds page numbers and running headers from cached ocrRuns on picture-only sheets', () => {
    const ocr: TextRun[] = [
      { text: 'Midterm Exam', rect: { x: 120, y: 32, width: 160, height: 16 }, fontSizePx: 12 },
      { text: 'Midterm Exam', rect: { x: 120, y: 1052, width: 160, height: 16 }, fontSizePx: 12 },
      { text: '7 / 20', rect: { x: 360, y: 960, width: 60, height: 16 }, fontSizePx: 12 },
      { text: '8 / 20', rect: { x: 360, y: 1980, width: 60, height: 16 }, fontSizePx: 12 },
    ];
    // Picture-only capture: zero DOM textRuns, all text comes from cached ocrRuns.
    const s = makeSession(800, 2040, [], ocr, { filter: 'original', y0: 10, y1: 2020, count: 2 });
    const a: Analysis = {
      ...makeAnalysis(800, 2040),
      sheets: {
        x0: 40,
        x1: 760,
        sheets: [
          { y0: 10, y1: 1000 },
          { y0: 1030, y1: 2020 },
        ],
      },
    };
    const project: Project = {
      annotations: [],
      crop: null,
      pages: 'auto',
      pageNumbers: { renumber: true, hideRunning: true },
    };
    const res = planPages(s, a, DEFAULT_SETTINGS, project);
    expect(res.ok && res.sheets).toBe(true);
    if (!res.ok) return;
    expect(hasCachedOcr(s, res.debug.slices, 'original', 2)).toBe(true);
    expect(hasCachedOcr(s, res.debug.slices, 'bw', 2)).toBe(false);
    const anns = effectiveAnnotations(s, res, project);
    expect(anns.filter((x) => x.kind === 'cover')).toHaveLength(4);
    expect(
      anns.filter((x) => x.kind === 'text').map((x) => (x.kind === 'text' ? x.text : '')),
    ).toEqual(['1 / 2', '2 / 2']);
  });

  it('strips cached ocrRuns under redactions in contentOf and summarizes frame bytes + OCR searchText', () => {
    const ocr: TextRun[] = [
      { text: 'Public line', rect: { x: 40, y: 100, width: 120, height: 16 }, fontSizePx: 12 },
      {
        text: 'alice@example.com',
        rect: { x: 40, y: 200, width: 160, height: 16 },
        fontSizePx: 12,
      },
    ];
    const s = makeSession(800, 1000, [], ocr, { filter: 'original', y0: 0, y1: 1000, count: 1 });
    const content = contentOf(
      s,
      [
        {
          id: 'r1',
          kind: 'blur',
          style: DEFAULT_STYLE,
          x: 35,
          y: 195,
          w: 180,
          h: 26,
        },
      ],
      true,
    );
    expect((content.textRuns ?? []).map((r) => r.text)).toEqual(['Public line']);

    const summary = summarizeFrames(
      [
        {
          blob: { size: 1200 },
          hints: {
            textRuns: [
              { text: 'DOM title', rect: { x: 0, y: 0, width: 80, height: 16 }, fontSizePx: 14 },
            ],
          },
        },
        { blob: { size: 800 }, hints: { textRuns: [] } },
      ],
      ocr,
    );
    expect(summary.bytes).toBe(2000);
    expect(summary.searchText).toBe('DOM title Public line alice@example.com');
  });
});

function makeSlices(n: number): PageSlice[] {
  return Array.from({ length: n }, (_, i) => ({
    x0: 0,
    x1: 800,
    y0: i * 1000,
    y1: (i + 1) * 1000,
    overlapTop: 0,
    breakKind: i === n - 1 ? 'end' : 'paragraph',
    cost: 0,
    warnings: [],
  }));
}

describe('applyPageSelection', () => {
  it('returns natural order and all slices when no exclusions or reordering are set', () => {
    const slices = makeSlices(4);
    const sel = applyPageSelection(slices, {});
    expect(sel.totalSlices).toBe(4);
    expect(sel.orderedIndices).toEqual([0, 1, 2, 3]);
    expect(sel.activeIndices).toEqual([0, 1, 2, 3]);
    expect(sel.activeSlices).toEqual(slices);
    expect(sel.excludedSet.size).toBe(0);
    expect(isNaturalOrder(sel.orderedIndices)).toBe(true);
  });

  it('excludes pages while keeping orderedIndices complete for reversible display', () => {
    const slices = makeSlices(4);
    const sel = applyPageSelection(slices, { excludedPages: [1, 3] });
    expect(sel.orderedIndices).toEqual([0, 1, 2, 3]);
    expect(sel.activeIndices).toEqual([0, 2]);
    expect(sel.activeSlices.map((s) => s.y0)).toEqual([0, 2000]);
    expect([...sel.excludedSet]).toEqual([1, 3]);
  });

  it('reorders pages and combines exclusion with custom order', () => {
    const slices = makeSlices(4);
    const sel = applyPageSelection(slices, {
      pageOrder: [2, 0, 3, 1],
      excludedPages: [0],
    });
    expect(sel.orderedIndices).toEqual([2, 0, 3, 1]);
    expect(sel.activeIndices).toEqual([2, 3, 1]);
    expect(sel.activeSlices.map((s) => s.y0)).toEqual([2000, 3000, 1000]);
    expect(isNaturalOrder(sel.orderedIndices)).toBe(false);
  });

  it('handles re-pagination when slice count grows or shrinks without crashing or losing new pages', () => {
    // Re-pagination added pages 3 and 4 that were not in stored pageOrder.
    const grew = applyPageSelection(makeSlices(5), { pageOrder: [2, 0, 1], excludedPages: [1] });
    expect(grew.orderedIndices).toEqual([2, 0, 1, 3, 4]);
    expect(grew.activeIndices).toEqual([2, 0, 3, 4]);

    // Re-pagination shrank to 2 pages; stale indices >= 2 are dropped cleanly.
    const shrank = applyPageSelection(makeSlices(2), {
      pageOrder: [3, 1, 2, 0],
      excludedPages: [2, 3],
    });
    expect(shrank.orderedIndices).toEqual([1, 0]);
    expect(shrank.activeIndices).toEqual([1, 0]);
    expect(shrank.excludedSet.size).toBe(0);
  });

  it('never returns 0 active slices when slices is non-empty, keeping orderedIndices[0] active', () => {
    const slices = makeSlices(3);
    const sel = applyPageSelection(slices, {
      pageOrder: [2, 0, 1],
      excludedPages: [0, 1, 2],
    });
    expect(sel.activeIndices).toEqual([2]);
    expect(sel.activeSlices).toEqual([slices[2]]);
    expect(sel.excludedSet.has(2)).toBe(false);
    expect(sel.excludedSet.has(0)).toBe(true);
    expect(sel.excludedSet.has(1)).toBe(true);
  });

  it('handles empty slices and duplicate/negative/non-integer indices safely', () => {
    const empty = applyPageSelection([], { pageOrder: [0], excludedPages: [0] });
    expect(empty.activeSlices).toEqual([]);
    expect(empty.orderedIndices).toEqual([]);
    expect(empty.totalSlices).toBe(0);

    const dirty = applyPageSelection(makeSlices(3), {
      pageOrder: [1, -1, 1, 1.5, NaN, 99, 0],
      excludedPages: [-2, 1.2, NaN, 1, 1, 50],
    });
    expect(dirty.orderedIndices).toEqual([1, 0, 2]);
    expect(dirty.activeIndices).toEqual([0, 2]);
    expect([...dirty.excludedSet]).toEqual([1]);
  });
});

describe('OCR cache parity and worker crash fallback', () => {
  it('validates cached OCR across reordered slices and strips stale OCR in allTextRuns', () => {
    const domRun: TextRun = {
      text: 'DOM line',
      rect: { x: 10, y: 50, width: 100, height: 16 },
      fontSizePx: 14,
    };
    const ocrRun: TextRun = {
      text: 'OCR line',
      rect: { x: 10, y: 1500, width: 100, height: 16 },
      fontSizePx: 14,
    };
    const s = makeSession(800, 3000, [domRun], [ocrRun], {
      filter: 'original',
      y0: 0,
      y1: 3000,
      count: 2,
    });
    const reordered = [makeSlices(3)[2]!, makeSlices(3)[0]!, makeSlices(3)[1]!];
    expect(hasValidCachedOcr(s, reordered, 'original', 2)).toBe(true);
    expect(hasCachedOcr(s, reordered, 'original', 2)).toBe(true);
    expect(allTextRuns(s, { slices: reordered, filter: 'original', ocrPageCount: 2 })).toEqual([
      domRun,
      ocrRun,
    ]);
    // Switching filter invalidates cached OCR so stale runs do not leak into allTextRuns.
    expect(allTextRuns(s, { slices: reordered, filter: 'bw', ocrPageCount: 2 })).toEqual([domRun]);
  });

  it('falls back inline when the analysis worker crashes mid-request', async () => {
    _resetAnalysisWorkerForTest();
    const origWorker = globalThis.Worker;
    class CrashingWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      onmessageerror: ((e: Event) => void) | null = null;
      terminated = false;
      postMessage(): void {
        // Simulate an async worker crash after the request is queued in pending.
        queueMicrotask(() => {
          this.onerror?.(new Event('error'));
        });
      }
      terminate(): void {
        this.terminated = true;
      }
    }
    globalThis.Worker = CrashingWorker as unknown as typeof Worker;
    try {
      const w = 500;
      const h = 400; // 200_000 px: hits the worker path in filterPixelsAsync
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 200;
        data[i + 1] = 40;
        data[i + 2] = 40;
        data[i + 3] = 255;
      }
      const img = { width: w, height: h, data } as unknown as ImageData;
      const out = await filterPixelsAsync(img, 'grey', 1);
      // Inline greyscale filter ran: R === G === B.
      expect(out.data[0]).toBe(out.data[1]);
      expect(out.data[1]).toBe(out.data[2]);
      expect(out.data[0]).toBeGreaterThan(40);
      expect(out.data[0]).toBeLessThan(200);
    } finally {
      globalThis.Worker = origWorker;
      _resetAnalysisWorkerForTest();
    }
  });
});
