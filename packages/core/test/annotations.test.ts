import { describe, expect, it } from 'vitest';
import { paginate } from '../src/paginate.js';
import {
  annotationAt,
  annotationForbidden,
  bounds,
  cropAround,
  commit,
  DEFAULT_STYLE,
  drawAnnotations,
  emptyHistory,
  hitTest,
  moveBy,
  moveByClamped,
  moveEndpoint,
  moveRegion,
  nextStepNumber,
  redactions,
  redo,
  resizeAnnotation,
  resizeRegion,
  undo,
  type Annotation,
  type AnnotationCtx,
  type ResizeHandle,
} from '../src/annotations.js';

const s = DEFAULT_STYLE;
const rect: Annotation = { id: 'r', kind: 'rect', style: s, x: 100, y: 100, w: 200, h: 100 };
const arrow: Annotation = { id: 'a', kind: 'arrow', style: s, x1: 0, y1: 0, x2: 100, y2: 100 };
const pen: Annotation = { id: 'p', kind: 'pen', style: s, points: [0, 500, 50, 520, 100, 500] };
const blur: Annotation = { id: 'b', kind: 'blur', style: s, x: 400, y: 0, w: 100, h: 50 };
const step = (n: number, x = 600, y = 600): Annotation => ({
  id: `s${n}`,
  kind: 'step',
  style: s,
  x,
  y,
  n,
});

describe('annotation model', () => {
  it('bounds and hit tests', () => {
    expect(bounds(arrow)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(hitTest(rect, 100, 150)).toBe(true); // on the left edge
    expect(hitTest(rect, 200, 150)).toBe(false); // inside a frame: click through
    expect(hitTest(arrow, 50, 50)).toBe(true);
    expect(hitTest(arrow, 80, 20)).toBe(false);
    expect(hitTest(pen, 25, 511)).toBe(true);
    expect(hitTest(blur, 450, 25)).toBe(true); // redactions are solid
  });

  it('picks the topmost annotation', () => {
    const over: Annotation = { ...rect, id: 'r2' };
    expect(annotationAt([rect, over], 100, 150)!.id).toBe('r2');
    expect(annotationAt([rect], 5, 900)).toBeNull();
  });

  it('moves every kind', () => {
    expect(bounds(moveBy(rect, 10, -5))).toEqual({ x: 110, y: 95, width: 200, height: 100 });
    expect(bounds(moveBy(pen, 5, 5)).y).toBe(505);
    const a = moveBy(arrow, 1, 2);
    expect(a.kind === 'arrow' && [a.x1, a.y1, a.x2, a.y2]).toEqual([1, 2, 101, 102]);
  });

  it('numbers steps after the highest one', () => {
    expect(nextStepNumber([step(1), step(4), rect])).toBe(5);
    expect(nextStepNumber([])).toBe(1);
  });

  it('lists redaction areas', () => {
    expect(redactions([rect, blur])).toEqual([{ x: 400, y: 0, width: 100, height: 50 }]);
  });
});

describe('annotations and pagination', () => {
  it('keeps small annotations whole, not tall frames or redactions', () => {
    const tall: Annotation = { ...rect, id: 't', h: 900 };
    const f = annotationForbidden([step(1, 50, 1000), tall, blur]);
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('atomic');
    expect(f[0]!.y0).toBeLessThan(1000 - 14);
    expect(f[0]!.y1).toBeGreaterThan(1000 + 14);
  });

  it('moves a break off a step marker', () => {
    // Blank page, breaks every 1000 px; a marker straddling y = 1000 pushes the break up.
    const input = { height: 3000, width: 800, T: 1000 };
    expect(paginate(input)[0]!.y1).toBe(1000);
    const hints = {
      forbidden: annotationForbidden([step(1, 50, 990)]),
      blockEnds: [],
      keepWithNext: [],
      opaque: [],
      tables: [],
      textRuns: [],
      links: [],
      headings: [],
    };
    const y1 = paginate({ ...input, hints })[0]!.y1;
    expect(y1).toBeLessThan(990 - 14);
  });

  it('widens an automatic crop to annotations in the margin', () => {
    const crop = { x0: 200, x1: 900, cropped: true };
    expect(cropAround(crop, [step(1, 180, 50)], 1200).x0).toBeLessThan(180 - 14);
    expect(cropAround(crop, [], 1200)).toEqual(crop);
    expect(cropAround({ x0: 0, x1: 1200, cropped: false }, [step(1, 5, 5)], 1200).x0).toBe(0);
    const wide = cropAround(crop, [{ ...arrow, x1: 0, x2: 1200 }], 1200);
    expect(wide).toEqual({ x0: 0, x1: 1200, cropped: false });
  });
});

describe('history', () => {
  it('undoes and redoes without limit; a new edit clears redo', () => {
    let h = emptyHistory();
    for (let i = 1; i <= 50; i++) h = commit(h, [...h.present, step(i)]);
    for (let i = 0; i < 50; i++) h = undo(h);
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present.map((a) => a.id)).toEqual(['s1', 's2']);
    h = commit(h, [rect]);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });
});

/** Records calls so drawing can be checked without a canvas. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) =>
      k in t
        ? t[k as string]
        : (...args: unknown[]) => {
            calls.push(
              `${String(k)}(${args.map((a) => (typeof a === 'number' ? Math.round(a) : a)).join(',')})`,
            );
          },
    set: (t, k, v) => {
      t[k as string] = v;
      calls.push(`${String(k)}=${v}`);
      return true;
    },
  }) as unknown as AnnotationCtx;
  return { ctx, calls };
}

describe('drawAnnotations', () => {
  it('draws only what intersects the region, redactions first, in region coordinates', () => {
    const { ctx, calls } = recorder();
    const effects: string[] = [];
    drawAnnotations(ctx, [rect, blur, step(1, 600, 2000)], { x0: 0, y0: 0, x1: 800, y1: 1000 }, 2, {
      blur: (x, y, w, h) => effects.push(`blur ${x},${y},${w},${h}`),
      pixelate: () => effects.push('pixelate'),
    });
    expect(effects).toEqual(['blur 800,0,200,100']);
    expect(calls).toContain('scale(2,2)');
    expect(calls).toContain('rect(100,100,200,100)');
    expect(calls.some((c) => c.startsWith('arc('))).toBe(false); // the step is off this page
  });

  it('places shapes relative to the page region', () => {
    const { ctx, calls } = recorder();
    drawAnnotations(ctx, [rect], { x0: 50, y0: 80, x1: 800, y1: 1000 }, 1);
    expect(calls).toContain('translate(-50,-80)');
  });
});

describe('resizeAnnotation', () => {
  const doc = { width: 800, height: 600 };

  it('resizes every box kind cleanly across all 8 handles', () => {
    const base: Annotation = { id: 'r1', kind: 'rect', style: s, x: 100, y: 100, w: 200, h: 100 };
    const cases: Array<[ResizeHandle, number, number, { x: number; y: number; w: number; h: number }]> = [
      ['nw', -20, -10, { x: 80, y: 90, w: 220, h: 110 }],
      ['n', 99, -25, { x: 100, y: 75, w: 200, h: 125 }],
      ['ne', 30, -15, { x: 100, y: 85, w: 230, h: 115 }],
      ['e', 40, 99, { x: 100, y: 100, w: 240, h: 100 }],
      ['se', 25, 35, { x: 100, y: 100, w: 225, h: 135 }],
      ['s', 99, 50, { x: 100, y: 100, w: 200, h: 150 }],
      ['sw', -30, 20, { x: 70, y: 100, w: 230, h: 120 }],
      ['w', -40, 99, { x: 60, y: 100, w: 240, h: 100 }],
    ];
    for (const [handle, dx, dy, expected] of cases) {
      const out = resizeAnnotation(base, handle, dx, dy, doc);
      expect(out.kind).toBe('rect');
      if (out.kind === 'rect') {
        expect({ x: out.x, y: out.y, w: out.w, h: out.h }).toEqual(expected);
      }
    }

    for (const kind of ['ellipse', 'blur', 'pixelate'] as const) {
      const box: Annotation = { id: kind, kind, style: s, x: 50, y: 60, w: 100, h: 80 };
      const out = resizeAnnotation(box, 'se', 20, -10, doc);
      expect(bounds(out)).toEqual({ x: 50, y: 60, width: 120, height: 70 });
    }
  });

  it('flips edges cleanly when dragged past the opposite edge', () => {
    const base: Annotation = { id: 'r1', kind: 'rect', style: s, x: 100, y: 100, w: 100, h: 80 };
    // Drag east edge past west edge (x=100) to x=40 -> [40, 100].
    const flipE = resizeAnnotation(base, 'e', -160, 0, doc);
    expect(bounds(flipE)).toEqual({ x: 40, y: 100, width: 60, height: 80 });
    // Drag west edge past east edge (x=200) to x=250 -> [200, 250].
    const flipW = resizeAnnotation(base, 'w', 150, 0, doc);
    expect(bounds(flipW)).toEqual({ x: 200, y: 100, width: 50, height: 80 });
    // Diagonal flip via nw past se (200, 180) to (260, 230).
    const flipNW = resizeAnnotation(base, 'nw', 160, 130, doc);
    expect(bounds(flipNW)).toEqual({ x: 200, y: 180, width: 60, height: 50 });
  });

  it('clamps strictly within document bounds and enforces minimum size >= 4', () => {
    const base: Annotation = { id: 'r1', kind: 'blur', style: s, x: 100, y: 100, w: 100, h: 100 };
    // Drag beyond all document edges.
    const pastMin = resizeAnnotation(base, 'nw', -500, -500, doc);
    expect(bounds(pastMin)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    const pastMax = resizeAnnotation(base, 'se', 1500, 1500, doc);
    expect(bounds(pastMax)).toEqual({ x: 100, y: 100, width: 700, height: 500 });

    // Attempt to collapse to 0 or 1 px: minimum 4 px enforced.
    const tiny = resizeAnnotation(base, 'e', -99, 0, doc);
    expect(bounds(tiny)).toEqual({ x: 100, y: 100, width: 4, height: 100 });
    const tinyFlip = resizeAnnotation(base, 'e', -101, 0, doc);
    expect(bounds(tinyFlip)).toEqual({ x: 96, y: 100, width: 4, height: 100 });

    // Near boundary x = 0: stays inside [0, width] with w = 4.
    const atEdge: Annotation = { id: 'e0', kind: 'rect', style: s, x: 0, y: 0, w: 20, h: 20 };
    const clampedEdge = resizeAnnotation(atEdge, 'e', -50, -50, doc);
    expect(bounds(clampedEdge)).toEqual({ x: 0, y: 0, width: 4, height: 20 });

    // Non-box annotations are returned unchanged.
    expect(resizeAnnotation(arrow, 'se', 50, 50, doc)).toBe(arrow);
    expect(resizeAnnotation(pen, 'se', 50, 50, doc)).toBe(pen);
  });
});

describe('moveEndpoint', () => {
  const doc = { width: 800, height: 600 };

  it('moves start and end points of arrows and lines and clamps to document bounds', () => {
    const movedStart = moveEndpoint(arrow, 'start', 20, 30, doc);
    expect(movedStart.kind === 'arrow' && [movedStart.x1, movedStart.y1, movedStart.x2, movedStart.y2]).toEqual([
      20, 30, 100, 100,
    ]);
    const movedEnd = moveEndpoint(arrow, 'end', 999, -20, doc);
    expect(movedEnd.kind === 'arrow' && [movedEnd.x1, movedEnd.y1, movedEnd.x2, movedEnd.y2]).toEqual([
      0, 0, 800, 0,
    ]);

    const line: Annotation = { id: 'l1', kind: 'line', style: s, x1: 10, y1: 10, x2: 50, y2: 50 };
    const lineEnd = moveEndpoint(line, 'start', -100, 700, doc);
    expect(lineEnd.kind === 'line' && [lineEnd.x1, lineEnd.y1]).toEqual([0, 600]);

    // Non-line/arrow unchanged.
    expect(moveEndpoint(rect, 'end', 50, 50, doc)).toBe(rect);
  });
});

describe('resizeRegion and moveRegion', () => {
  const doc = { width: 1000, height: 800 };
  const crop = { x0: 100, x1: 500, y0: 100, y1: 400 };

  it('resizes across all 8 handles, normalizes flipped drags, clamps, and enforces minSize', () => {
    expect(resizeRegion(crop, 'nw', -50, -20, doc)).toEqual({ x0: 50, x1: 500, y0: 80, y1: 400 });
    expect(resizeRegion(crop, 'se', 100, 50, doc)).toEqual({ x0: 100, x1: 600, y0: 100, y1: 450 });
    expect(resizeRegion(crop, 'n', 99, 50, doc)).toEqual({ x0: 100, x1: 500, y0: 150, y1: 400 });
    expect(resizeRegion(crop, 's', 99, -50, doc)).toEqual({ x0: 100, x1: 500, y0: 100, y1: 350 });
    expect(resizeRegion(crop, 'w', 50, 99, doc)).toEqual({ x0: 150, x1: 500, y0: 100, y1: 400 });
    expect(resizeRegion(crop, 'e', -50, 99, doc)).toEqual({ x0: 100, x1: 450, y0: 100, y1: 400 });
    expect(resizeRegion(crop, 'ne', 1000, -500, doc)).toEqual({ x0: 100, x1: 1000, y0: 0, y1: 400 });
    expect(resizeRegion(crop, 'sw', -500, 1000, doc)).toEqual({ x0: 0, x1: 500, y0: 100, y1: 800 });

    // Flip east edge past west edge.
    expect(resizeRegion(crop, 'e', -450, 0, doc)).toEqual({ x0: 50, x1: 100, y0: 100, y1: 400 });

    // Default minSize = 20 enforced.
    const minClamped = resizeRegion(crop, 'e', -395, 0, doc);
    expect(minClamped.x1 - minClamped.x0).toBe(20);
    expect(minClamped).toEqual({ x0: 100, x1: 120, y0: 100, y1: 400 });

    // Custom minSize.
    const customMin = resizeRegion(crop, 's', -290, 0, doc, 40);
    expect(customMin.y1 - customMin.y0).toBe(300); // s ignores dx
    const customMinY = resizeRegion(crop, 's', 0, -290, doc, 40);
    expect(customMinY.y1 - customMinY.y0).toBe(40);
  });

  it('moves a crop region preserving size and clamping within document bounds', () => {
    expect(moveRegion(crop, 50, -30, doc)).toEqual({ x0: 150, x1: 550, y0: 70, y1: 370 });
    expect(moveRegion(crop, -500, -500, doc)).toEqual({ x0: 0, x1: 400, y0: 0, y1: 300 });
    expect(moveRegion(crop, 900, 900, doc)).toEqual({ x0: 600, x1: 1000, y0: 500, y1: 800 });
  });
});

describe('moveByClamped', () => {
  const doc = { width: 400, height: 300 };

  it('nudges annotations and clamps cleanly against document edges', () => {
    const r: Annotation = { id: 'r', kind: 'rect', style: s, x: 5, y: 10, w: 100, h: 50 };
    expect(bounds(moveByClamped(r, -10, -10, doc))).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(bounds(moveByClamped(r, 1000, 1000, doc))).toEqual({
      x: 300,
      y: 250,
      width: 100,
      height: 50,
    });
    // Already against edge -> returns identical reference.
    const atZero: Annotation = { ...r, x: 0, y: 0 };
    expect(moveByClamped(atZero, -1, 0, doc)).toBe(atZero);
  });
});
