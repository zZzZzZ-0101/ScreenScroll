import { describe, expect, it } from 'vitest';
import {
  ctcDecode,
  dbBoxes,
  mergeTileBoxes,
  readingOrder,
  readText,
  tiles,
  toTensor,
  PP_OCR_V6_SMALL,
  type OcrRuntime,
} from '../src/ocr/index.js';

const cfg = PP_OCR_V6_SMALL.det;

/** A w × h probability map with `p` inside each rectangle. */
function map(w: number, h: number, rects: Array<[number, number, number, number]>, p = 0.9) {
  const m = new Float32Array(w * h);
  for (const [x, y, rw, rh] of rects)
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) m[j * w + i] = p;
  return m;
}

describe('DB boxes', () => {
  it('one box per region, grown by area · 1.5 / perimeter', () => {
    const boxes = dbBoxes(
      map(200, 100, [
        [20, 30, 100, 10],
        [20, 60, 40, 8],
      ]),
      200,
      100,
      cfg,
    );
    expect(boxes).toHaveLength(2);
    const d = (100 * 10 * 1.5) / (2 * 110);
    expect(boxes[0]!.x).toBeCloseTo(20 - d, 5);
    expect(boxes[0]!.w).toBeCloseTo(100 + 2 * d, 5);
    expect(boxes[0]!.score).toBeCloseTo(0.9, 5);
  });

  it('drops faint regions and specks', () => {
    expect(dbBoxes(map(100, 50, [[10, 10, 50, 10]], 0.5), 100, 50, cfg)).toEqual([]);
    expect(dbBoxes(map(100, 50, [[10, 10, 2, 2]]), 100, 50, cfg)).toEqual([]);
  });

  it('tiles cover the image with the overlap; duplicates across tiles merge', () => {
    const t = tiles(3000, 1000, 1280, 128);
    expect(t.at(-1)).toMatchObject({ x: 3000 - 1280, w: 1280, h: 1000 });
    for (let i = 1; i < t.length; i++)
      expect(t[i]!.x).toBeLessThanOrEqual(t[i - 1]!.x + 1280 - 128);
    expect(tiles(500, 400, 1280, 128)).toEqual([{ x: 0, y: 0, w: 500, h: 400 }]);
    const a = { x: 0, y: 0, w: 100, h: 20, score: 0.9 };
    const b = { x: 2, y: 1, w: 98, h: 19, score: 0.8 };
    const c = { x: 0, y: 40, w: 100, h: 20, score: 0.7 };
    expect(mergeTileBoxes([b, a, c])).toEqual([a, c]);
    // A copy cut off at a tile edge loses to the whole one even with a higher score.
    const whole = { x: 0, y: 0, w: 300, h: 20, score: 0.8 };
    const cutCopy = { x: 120, y: 0, w: 180, h: 20, score: 0.95, cut: true };
    expect(mergeTileBoxes([cutCopy, whole])).toEqual([whole]);
  });
});

describe('CTC and reading order', () => {
  it('collapses repeats, drops blanks, keeps doubled letters split by a blank', () => {
    const dict = ['a', 'b', 'l'];
    // steps: a a _ b l _ l   (classes: 0 blank, 1 a, 2 b, 3 l)
    const seq = [1, 1, 0, 2, 3, 0, 3];
    const probs = new Float32Array(seq.length * 4);
    seq.forEach((c, t) => (probs[t * 4 + c] = 0.9));
    const r = ctcDecode(probs, seq.length, 4, dict);
    expect(r.text).toBe('abll');
    expect(r.confidence).toBeCloseTo(0.9, 5);
  });

  it('rows top to bottom, left to right within a row', () => {
    const b = (x: number, y: number, h = 20) => ({ x, y, h, w: 50 });
    expect(readingOrder([b(300, 102), b(10, 100), b(10, 160), b(150, 98)])).toEqual([
      b(10, 100),
      b(150, 98),
      b(300, 102),
      b(10, 160),
    ]);
  });
});

describe('tensors and the pipeline', () => {
  it('normalises per channel in BGR order and pads with 0', () => {
    const img = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]),
    };
    const t = toTensor(img, { x: 0, y: 0, w: 2, h: 1 }, 2, 1, 4, 1, PP_OCR_V6_SMALL.rec);
    expect(t.dims).toEqual([1, 3, 1, 4]);
    // Plane 0 is blue (0 → −1), plane 2 is red (255 → +1); padding stays 0.
    expect([...t.data.slice(0, 4)]).toEqual([-1, -1, 0, 0]);
    expect([...t.data.slice(8, 12)]).toEqual([1, 1, 0, 0]);
  });

  it('runs detection per tile, maps boxes back, recognises each line in order', async () => {
    const img = { width: 400, height: 200, data: new Uint8ClampedArray(400 * 200 * 4).fill(255) };
    const calls: string[] = [];
    const rt: OcrRuntime = {
      async run(model, input) {
        calls.push(`${model}:${input.dims.join('x')}`);
        if (model === 'det') {
          const [, , h, w] = input.dims as number[];
          return {
            data: map(w!, h!, [
              [40, 40, 200, 12],
              [40, 120, 100, 12],
            ]),
            dims: [1, 1, h!, w!],
          };
        }
        const steps = (input.dims[3] ?? 320) / 8;
        const probs = new Float32Array(steps * 3);
        probs[1] = 1; // "x"
        for (let t = 1; t < steps; t++) probs[t * 3] = 1;
        return { data: probs, dims: [1, steps, 3] };
      },
    };
    const lines = await readText(img, PP_OCR_V6_SMALL, rt, ['x', 'y'], { detScale: 2 });
    expect(calls[0]).toBe('det:1x3x416x800'); // 800 × 400 rounded up to multiples of 32
    expect(lines.map((l) => l.text)).toEqual(['x', 'x']);
    // Detected at 2×: boxes come back in image pixels.
    expect(lines[0]!.box.y).toBeLessThan(22);
    expect(lines[0]!.box.y + lines[0]!.box.h).toBeGreaterThan(26);
    expect(lines[1]!.box.y).toBeGreaterThan(55);
  });
});

describe('OCR text into the PDF', () => {
  it('maps image px back to document coordinates and skips text the page already has', async () => {
    const { ocrRuns } = await import('../src/ocr/index.js');
    const lines = [
      { text: 'Hello', confidence: 0.98, box: { x: 20, y: 40, w: 100, h: 24 } },
      { text: 'dup', confidence: 0.99, box: { x: 20, y: 100, w: 60, h: 24 } },
      { text: '??', confidence: 0.2, box: { x: 20, y: 160, w: 60, h: 24 } },
    ];
    const existing = [{ rect: { x: 10, y: 1050, width: 40, height: 12 } }];
    const runs = ocrRuns(lines, { x0: 0, y0: 1000 }, 2, existing);
    expect(runs).toEqual([
      { text: 'Hello', rect: { x: 10, y: 1020, width: 50, height: 12 }, fontSizePx: 12 },
    ]);
  });

  it('auto reads only pages without their own text; always reads all; off none', async () => {
    const { pagesNeedingOcr } = await import('../src/ocr/index.js');
    const slices = [
      { x0: 0, x1: 800, y0: 0, y1: 1000 },
      { x0: 0, x1: 800, y0: 1000, y1: 2000 },
    ];
    const runs = [
      { rect: { x: 10, y: 100, width: 300, height: 16 }, text: 'A real paragraph of page text.' },
    ];
    expect(pagesNeedingOcr('auto', slices, runs)).toEqual([1]);
    expect(pagesNeedingOcr('always', slices, runs)).toEqual([0, 1]);
    expect(pagesNeedingOcr('off', slices, runs)).toEqual([]);
  });
});
