import { describe, expect, it } from 'vitest';
import { BlockPrinter, diffPictures, type GreyImage, type PictureBlock } from '../src/index.js';

const W = 120;
const LINE = 14;
const GAP = 9; // not a round number: changes shift content by odd amounts

/** A page of "lines" of ink with blank gaps; each label draws a distinct pattern. */
function page(labels: number[], top = 5): GreyImage {
  const h = top + labels.length * (LINE + GAP);
  const data = new Uint8Array(W * h).fill(250);
  labels.forEach((label, k) => {
    const y0 = top + k * (LINE + GAP);
    for (let y = y0; y < y0 + LINE; y++)
      for (let x = 10; x < 100; x++)
        if (((x * 7 + label * 13) >> 3) % 3 === 0) data[y * W + x] = 30;
  });
  return { width: W, height: h, data };
}

function blocks(img: GreyImage, chunk = 37): PictureBlock[] {
  // Pushed in uneven chunks, as frames arrive.
  const p = new BlockPrinter(W);
  for (let y = 0; y < img.height; y += chunk) {
    const h = Math.min(chunk, img.height - y);
    p.push({ width: W, height: h, data: img.data.subarray(y * W, (y + h) * W) });
  }
  return p.finish();
}

const at = (k: number, top = 5) => top + k * (LINE + GAP);

describe('diffPictures', () => {
  const base = Array.from({ length: 40 }, (_, i) => i + 1);

  it('finds nothing between identical captures, however the rows arrive', () => {
    expect(diffPictures(blocks(page(base)), blocks(page(base), 100))).toEqual([]);
  });

  it('still matches content shifted by an odd number of pixels', () => {
    expect(diffPictures(blocks(page(base)), blocks(page(base, 12)))).toEqual([]);
  });

  it('aligns past an insertion and finds an edit further down', () => {
    const newer = [...base.slice(0, 10), 900, 901, ...base.slice(10)];
    newer[30] = 777; // base[28] replaced
    const changes = diffPictures(blocks(page(base)), blocks(page(newer)));
    expect(changes.map((c) => [c.removed, c.added])).toEqual([
      [null, { y0: at(10), y1: at(11) + LINE }],
      [
        { y0: at(28), y1: at(28) + LINE },
        { y0: at(30), y1: at(30) + LINE },
      ],
    ]);
    expect(changes[0]!.x0).toBeGreaterThanOrEqual(10);
    expect(changes[0]!.x1).toBeLessThanOrEqual(100);
  });

  it('reports a removal', () => {
    const newer = [...base.slice(0, 20), ...base.slice(25)];
    expect(
      diffPictures(blocks(page(base)), blocks(page(newer))).map((c) => [c.removed, c.added]),
    ).toEqual([[{ y0: at(20), y1: at(24) + LINE }, null]]);
  });

  it('ignores small grey noise', () => {
    const a = page(base);
    const b = { ...a, data: a.data.map((v, i) => Math.max(0, Math.min(255, v + ((i % 5) - 2)))) };
    expect(diffPictures(blocks(a), blocks(b))).toEqual([]);
  });
});
