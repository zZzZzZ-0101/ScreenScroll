import { describe, expect, it } from 'vitest';
import {
  annotationAt,
  bounds,
  commit,
  DEFAULT_STYLE,
  drawAnnotations,
  emptyHistory,
  hitTest,
  moveBy,
  nextStepNumber,
  redactions,
  redo,
  undo,
  type Annotation,
  type AnnotationCtx,
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
