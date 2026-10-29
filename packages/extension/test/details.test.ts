import { computeLayout, type PageSlice } from '@screenscroll/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { buildDetails, bytes, detailsText } from '../src/studio/engine/details';
import type { LoadedSession } from '../src/studio/engine/session';

const session = {
  session: {
    id: 's',
    url: 'https://example.org/a',
    title: 'A page',
    capturedAt: '2026-10-29T10:00:00Z',
    status: 'complete',
    docWidth: 800,
    docHeight: 3000,
    frameCount: 4,
    warnings: [],
    tabId: 1,
    windowId: 1,
  },
  frames: [{}, {}, {}, {}],
  geoms: [],
  hints: {
    textRuns: [{ fontSizePx: 16 }, { fontSizePx: 16 }, { fontSizePx: 24 }],
    links: [{}],
    headings: [{}, {}],
    forbidden: [],
  },
  width: 800,
  height: 3000,
  dpr: 2,
  project: { annotations: [], crop: null },
} as unknown as LoadedSession;

const slice = (y0: number, y1: number, overlapTop = 0): PageSlice => ({
  y0,
  y1,
  x0: 0,
  x1: 800,
  overlapTop,
  breakKind: 'paragraph',
  cost: 3.2,
  warnings: [],
});

function details(settings: Settings = DEFAULT_SETTINGS) {
  const layout = computeLayout(settings.page, 800);
  return {
    layout,
    d: buildDetails({
      session,
      settings,
      layout,
      crop: { x0: 0, x1: 800, cropped: false },
      slices: [slice(0, 1100), slice(1100, 2200, 40), slice(2200, 3000)],
      sheets: false,
      estimate: 1_572_864,
      ocr: { pages: [2], ready: false },
    }),
  };
}
const row = (d: ReturnType<typeof details>['d'], label: string) =>
  d.sections.flatMap((s) => s.rows).find((r) => r.label === label)!;

describe('Details panel numbers', () => {
  it('layout: scale, content per page, text size and dpi, with the calculation', () => {
    const { d, layout } = details();
    expect(row(d, 'Scale s').value).toBe(`${layout.s.toFixed(4)} pt per CSS px`);
    expect(row(d, 'Scale s').how).toContain('box width ÷ content width');
    expect(row(d, 'Content per page T').value).toBe(
      `${Math.round(layout.T).toLocaleString('en-US')} px`,
    );
    // Median text 16 px × s.
    expect(row(d, 'Body text on paper').value).toBe(`${(16 * layout.s).toFixed(1)} pt`);
    const dpi = (2 * 72) / layout.s;
    expect(row(d, 'Image resolution on paper').value).toBe(`${Math.round(dpi)} dpi`);
  });

  it('output: the quality cap scales images and the pages table follows', () => {
    const { d, layout } = details({ ...DEFAULT_SETTINGS, exportPreset: 'compact' });
    const dpi = (2 * 72) / layout.s;
    const scale = Math.min(1, 150 / dpi);
    expect(row(d, 'Image scale').value).toBe(scale.toFixed(3).replace(/0+$/, ''));
    expect(d.pages).toHaveLength(3);
    expect(d.pages[0]).toMatchObject({ n: 1, height: 1100, imageW: Math.round(1600 * scale) });
    expect(d.pages[1]!.overlap).toBe(40);
    expect(row(d, 'Forced cuts').value).toBe('1');
    expect(row(d, 'Estimated size').value).toBe('1.5 MB');
    expect(row(d, 'Text recognition').value).toBe('auto · pages 3 · model not downloaded');
  });

  it('copies as plain text with every section and page', () => {
    const text = detailsText(details().d);
    for (const h of ['## Capture', '## Page layout', '## Page breaks', '## Output', '## Pages'])
      expect(text).toContain(h);
    expect(text.split('\n').filter((l) => /^\d+\t/.test(l))).toHaveLength(3);
  });

  it('sizes', () => {
    expect(bytes(500)).toBe('500 B');
    expect(bytes(2048)).toBe('2 KB');
    expect(bytes(3 * 1048576)).toBe('3 MB');
  });
});
