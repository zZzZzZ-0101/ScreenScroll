import { DEFAULT_STYLE, emptyHints, RowAnalyzer, type TextRun } from '@screenscroll/core';
import { describe, expect, it } from 'vitest';
import { summarizeFrames, type OcrMeta, type Project } from '../src/shared/db';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { Analysis } from '../src/studio/engine/analysis';
import { contentOf, hasCachedOcr } from '../src/studio/engine/export';
import { effectiveAnnotations, planPages } from '../src/studio/engine/plan';
import type { LoadedSession } from '../src/studio/engine/session';

function makeAnalysis(width: number, height: number): Analysis {
  const analyzer = new RowAnalyzer(width, 1);
  const data = new Uint8Array(width * height).fill(255);
  analyzer.push({ width, height, data, channels: 1 });
  return {
    rows: analyzer.finish(),
    strip: [],
    stripScale: 1,
    sheets: null,
    readings: [],
    evidence: null,
    geoms: [],
    height,
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
    expect(content.textRuns.map((r) => r.text)).toEqual(['Public line']);

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
