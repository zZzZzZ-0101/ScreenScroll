import { describe, expect, it } from 'vitest';
import { emptyHints, mergeHints, type DomHints } from '../src/hints.js';

const frame = (patch: Partial<DomHints>): DomHints => ({ ...emptyHints(), ...patch });

describe('mergeHints', () => {
  it('de-duplicates entries reported by overlapping frames, tolerating sub-pixel drift', () => {
    const a = frame({
      forbidden: [{ y0: 10, y1: 30, kind: 'line' }],
      blockEnds: [{ y: 40, kind: 'paragraph' }],
      links: [{ href: 'https://example.org/', rect: { x: 5, y: 12, width: 40, height: 16 } }],
      textRuns: [{ text: 'Hello', rect: { x: 5, y: 12, width: 40, height: 16 }, fontSizePx: 16 }],
    });
    const b = frame({
      forbidden: [
        { y0: 10.2, y1: 29.9, kind: 'line' },
        { y0: 50, y1: 70, kind: 'line' },
      ],
      blockEnds: [{ y: 40.1, kind: 'paragraph' }],
      links: [{ href: 'https://example.org/', rect: { x: 5, y: 12.3, width: 40, height: 16 } }],
      textRuns: [{ text: 'Hello', rect: { x: 5, y: 11.8, width: 40, height: 16 }, fontSizePx: 16 }],
    });
    const m = mergeHints([a, b]);
    expect(m.forbidden).toEqual([
      { y0: 10, y1: 30, kind: 'line' },
      { y0: 50, y1: 70, kind: 'line' },
    ]);
    expect(m.blockEnds).toHaveLength(1);
    expect(m.links).toHaveLength(1);
    expect(m.textRuns).toHaveLength(1);
  });

  it('keeps distinct entries at the same position when their kind or text differs', () => {
    const m = mergeHints([
      frame({
        forbidden: [
          { y0: 0, y1: 100, kind: 'image' },
          { y0: 0, y1: 100, kind: 'line' },
        ],
        textRuns: [
          { text: 'A', rect: { x: 0, y: 0, width: 10, height: 10 }, fontSizePx: 12 },
          { text: 'B', rect: { x: 0, y: 0, width: 10, height: 10 }, fontSizePx: 12 },
        ],
      }),
    ]);
    expect(m.forbidden).toHaveLength(2);
    expect(m.textRuns).toHaveLength(2);
  });

  it('is deterministic regardless of frame order', () => {
    const a = frame({
      blockEnds: [{ y: 300, kind: 'section' }],
      keepWithNext: [{ y0: 280, y1: 330 }],
    });
    const b = frame({ blockEnds: [{ y: 100, kind: 'line' }], keepWithNext: [{ y0: 80, y1: 120 }] });
    expect(mergeHints([a, b])).toEqual(mergeHints([b, a]));
    expect(mergeHints([a, b]).blockEnds.map((x) => x.y)).toEqual([100, 300]);
  });
});
