import { describe, expect, it } from 'vitest';
import { chooseImageFormat } from '../src/pdf/format.js';

describe('chooseImageFormat', () => {
  it('keeps text-like images as PNG', () => {
    const px = new Uint8Array(200 * 200 * 4).fill(255);
    for (let i = 0; i < px.length; i += 4 * 7) px.set([20, 20, 20, 255], i);
    expect(chooseImageFormat(px)).toBe('png');
  });

  it('picks JPEG for photo-like noise', () => {
    const px = new Uint8Array(200 * 200 * 4);
    let s = 1;
    for (let i = 0; i < px.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      px[i] = s >>> 24;
    }
    expect(chooseImageFormat(px)).toBe('jpeg');
  });
});
