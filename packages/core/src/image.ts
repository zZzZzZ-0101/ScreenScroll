/** Minimal image buffer shape, so core never depends on DOM `ImageData`. */
export interface PixelBuffer {
  width: number;
  height: number;
  /** Row-major pixels with `channels` bytes per pixel. */
  data: Uint8Array | Uint8ClampedArray;
  /** 1 = grey, 4 = RGBA. */
  channels: 1 | 4;
}

export interface GreyImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Luma (BT.601) grey conversion; alpha is ignored because captures are opaque. */
export function toGrey(img: PixelBuffer): GreyImage {
  const { width, height, data, channels } = img;
  const out = new Uint8Array(width * height);
  if (channels === 1) {
    out.set(data.subarray(0, width * height));
    return { width, height, data: out };
  }
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (data[j]! * 299 + data[j + 1]! * 587 + data[j + 2]! * 114 + 500) / 1000;
  }
  return { width, height, data: out };
}
