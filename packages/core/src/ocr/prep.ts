import type { Rgba, Tensor } from './types.js';

export interface Norm {
  colorOrder: 'BGR' | 'RGB';
  mean: [number, number, number];
  std: [number, number, number];
  scale: number;
}

/**
 * Samples the source rectangle (sx, sy, sw, sh) of `img` bilinearly into an outW × outH
 * area at the top-left of a 1 × 3 × tensorH × tensorW tensor, normalised per channel:
 * (v · scale − mean) / std. The rest of the tensor stays 0 (the mean colour), which is what
 * PaddleOCR pads with.
 */
export function toTensor(
  img: Rgba,
  src: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
  tensorW: number,
  tensorH: number,
  n: Norm,
): Tensor {
  const plane = tensorW * tensorH;
  const data = new Float32Array(3 * plane);
  const order = n.colorOrder === 'BGR' ? [2, 1, 0] : [0, 1, 2];
  const k = order.map((c, i) => ({ c, a: n.scale / n.std[i]!, b: n.mean[i]! / n.std[i]! }));
  const fx = src.w / outW;
  const fy = src.h / outH;
  const { width: W, height: H, data: px } = img;
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(H - 1, Math.max(0, src.y + (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(H - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(W - 1, Math.max(0, src.x + (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(W - 1, x0 + 1);
      const wx = sx - x0;
      const i00 = (y0 * W + x0) * 4;
      const i01 = (y0 * W + x1) * 4;
      const i10 = (y1 * W + x0) * 4;
      const i11 = (y1 * W + x1) * 4;
      const at = y * tensorW + x;
      for (let i = 0; i < 3; i++) {
        const { c, a, b } = k[i]!;
        const v =
          (px[i00 + c]! * (1 - wx) + px[i01 + c]! * wx) * (1 - wy) +
          (px[i10 + c]! * (1 - wx) + px[i11 + c]! * wx) * wy;
        data[i * plane + at] = v * a - b;
      }
    }
  }
  return { data, dims: [1, 3, tensorH, tensorW] };
}

export const roundUp = (v: number, m: number) => Math.ceil(v / m) * m;
