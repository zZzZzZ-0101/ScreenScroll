import { describe, expect, it } from 'vitest';
import type { GreyImage } from '../src/image.js';
import { checkSeam, registerFrames } from '../src/registration.js';

/** A tall page with irregular "text" blocks, from a seeded PRNG so it is deterministic. */
function page(width: number, height: number, seed = 1): GreyImage {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const data = new Uint8Array(width * height).fill(250);
  let y = 4;
  while (y < height - 12) {
    const h = 6 + Math.floor(rnd() * 8);
    const x0 = Math.floor(rnd() * width * 0.3);
    const x1 = x0 + Math.floor(width * (0.3 + rnd() * 0.6));
    for (let r = y; r < Math.min(height, y + h); r++)
      data.fill(30, r * width + x0, r * width + Math.min(width, x1));
    y += h + 3 + Math.floor(rnd() * 10);
  }
  return { width, height, data };
}

function crop(img: GreyImage, y0: number, h: number): GreyImage {
  return {
    width: img.width,
    height: h,
    data: img.data.slice(y0 * img.width, (y0 + h) * img.width),
  };
}

describe('registerFrames', () => {
  it('recovers the scroll shift between overlapping frames', () => {
    const doc = page(200, 1200);
    const r = registerFrames(crop(doc, 0, 300), crop(doc, 237, 300));
    expect(r).toMatchObject({ shift: 237, confident: true });
    expect(r.score).toBeGreaterThan(0.99);
  });

  it('is not confident on featureless frames', () => {
    const blank: GreyImage = { width: 100, height: 200, data: new Uint8Array(100 * 200).fill(255) };
    expect(registerFrames(blank, blank).confident).toBe(false);
  });

  it('is not confident on a periodic pattern with no unique match', () => {
    const w = 64;
    const h = 240;
    const data = new Uint8Array(w * h).fill(255);
    for (let y = 0; y < h; y++) if (y % 20 < 8) data.fill(0, y * w, (y + 1) * w);
    const img = { width: w, height: h, data };
    expect(registerFrames(img, crop(img, 40, 200)).confident).toBe(false);
  });
});

describe('checkSeam', () => {
  it('detects an unanchored duplicated seam band and reports the exact shift', () => {
    const doc = page(200, 1000, 7);
    // Frame 0 kept [0, 400); Frame 1 was supposed to start at 400 (nominalOverlap 0),
    // but content shifted down by 42 px so Frame 1 actually starts at 358.
    const prevTail = crop(doc, 200, 200);
    const currHead = crop(doc, 358, 200);
    const res = checkSeam(prevTail, currHead, 0);
    expect(res).toMatchObject({ kind: 'adjusted', overlap: 42, delta: 42 });
  });

  it('leaves adjacent non-overlapping prose frames untouched (no false positives)', () => {
    const doc = page(200, 1000, 42);
    const prevTail = crop(doc, 200, 200);
    const currHead = crop(doc, 400, 200);
    expect(checkSeam(prevTail, currHead, 0).kind).toBe('ok');
  });

  it('flags an unverified seam when a nominal overlap redrew to different pixels', () => {
    const a = page(200, 300, 11);
    const b = page(200, 300, 99);
    expect(checkSeam(crop(a, 100, 200), crop(b, 0, 200), 80).kind).toBe('unverified');
  });
});
