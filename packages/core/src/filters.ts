/**
 * Page filters, like a document scanner app's: applied to each composed page image before
 * mark-up is drawn, so arrows and boxes keep their colours. Pure functions on RGBA pixels.
 *
 * The parameters come from published methods, not from any app (scanner apps don't publish
 * theirs): Sauvola & Pietikäinen (2000) adaptive thresholding with the commonly used k = 0.2
 * and R = 128; ITU-R BT.709 luma for grey; percentile levels as in ImageMagick's
 * -contrast-stretch; a [1 2 1] unsharp mask. Windows are given in CSS px and scaled to the
 * image, so a page looks the same at any capture sharpness.
 */

export type FilterId = 'original' | 'enhance' | 'sharpen' | 'grey' | 'bw' | 'inksaver';

export interface FilterInfo {
  id: FilterId;
  name: string;
  /** One line under the name. */
  short: string;
  /** What it does, in plain sentences. */
  details: string;
  bestFor: string;
  notFor: string;
  /** The exact method and numbers, for those who want them. */
  params: string;
}

export const FILTERS: readonly FilterInfo[] = [
  {
    id: 'original',
    name: 'Original',
    short: 'Exactly as captured',
    details: 'Keeps every pixel as the page showed it. Nothing is changed.',
    bestFor: 'Records and evidence, photos, design reviews, anything where colours matter.',
    notFor: 'Saving printer ink.',
    params: 'identity',
  },
  {
    id: 'enhance',
    name: 'Enhanced',
    short: 'Whiter background, darker text',
    details:
      'Turns a grey or off-white background white, darkens faint text and makes colours a little richer. Pictures stay in colour.',
    bestFor: 'Pages with grey backgrounds or pale text; reading on screen and colour printing.',
    notFor: 'Exact colours (brand checks, design work).',
    params:
      'levels: paper = P85 luma (light page) or P99.5 → 255, ink = P0.5 → 0 · gamma 1.25 · saturation ×1.15',
  },
  {
    id: 'sharpen',
    name: 'Sharper text',
    short: 'Crisper small print',
    details:
      'Strengthens the edges of letters and lines a little. Colours stay the same. Captures at High or Maximum sharpness need it less.',
    bestFor: 'Small print captured at standard resolution; text that looks soft.',
    notFor: 'Photos with fine noise, which it makes more visible.',
    params: 'unsharp mask · kernel [1 2 1]⊗[1 2 1]/16 · amount 0.7',
  },
  {
    id: 'grey',
    name: 'Greyscale',
    short: 'Shades of grey',
    details:
      'Removes colour and keeps every shade, so pictures still look like pictures. Uses the standard screen brightness formula.',
    bestFor: 'Printing on a black-and-white printer; documents that mix text and pictures.',
    notFor: 'Charts or maps that rely on colour.',
    params: 'Y = 0.2126 R + 0.7152 G + 0.0722 B (ITU-R BT.709)',
  },
  {
    id: 'bw',
    name: 'Black & white',
    short: 'Pure black text on white, for printing',
    details:
      'Every pixel becomes black or white, judged against its surroundings, so faint grey text turns solid black. White text on dark buttons or dark-mode pages comes out as black text on white. Gives the smallest files and the sharpest print.',
    bestFor: 'Text: articles, contracts, receipts, forms, code; laser printers and faxing.',
    notFor: 'Photos and screenshots of pictures, which become blotchy.',
    params:
      'Sauvola 2000 · T = m·(1 + k·(s/R − 1)) · window 25 CSS px · k 0.2 · R 128 · window mean < 110 → judged inverted',
  },
  {
    id: 'inksaver',
    name: 'Ink saver',
    short: 'Dark backgrounds turned light',
    details:
      'Finds dark areas (dark mode, dark headers, code blocks) and turns them light with dark text, keeping their colours’ hue. Near-white backgrounds become pure white.',
    bestFor: 'Printing dark-mode pages and pages with dark panels.',
    notFor: 'Photos inside dark areas, which come out like negatives.',
    params: 'window mean (41 CSS px) < 100 → Y′ = 255 − Y, Cb/Cr kept · Y ≥ 235 → 255',
  },
];

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Applies a filter in place. `pxPerCss` is the image's pixels per CSS px (capture density ×
 * preview or export scale), which sets the size of the neighbourhoods the filters look at.
 */
export function applyFilter(id: FilterId, img: Rgba, pxPerCss = 1): void {
  switch (id) {
    case 'original':
      return;
    case 'enhance':
      return enhance(img);
    case 'sharpen':
      return sharpen(img);
    case 'grey':
      return grey(img);
    case 'bw':
      return blackWhite(img, pxPerCss);
    case 'inksaver':
      return inkSaver(img, pxPerCss);
  }
}

const luma709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function grey(img: Rgba): void {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = luma709(d[i]!, d[i + 1]!, d[i + 2]!);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
}

function lumaOf(img: Rgba): Uint8Array {
  const d = img.data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = luma709(d[j]!, d[j + 1]!, d[j + 2]!);
  return out;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = p * total;
  let n = 0;
  for (let v = 0; v < 256; v++) {
    n += hist[v]!;
    if (n >= target) return v;
  }
  return 255;
}

/**
 * Levels: the paper level (the 85th brightness percentile on a light page, the usual
 * background) becomes white and the darkest 0.5% black; a mild curve darkens mid-tones
 * (faint text) and saturation rises 15%.
 */
function enhance(img: Rgba): void {
  const y = lumaOf(img);
  const hist = new Uint32Array(256);
  for (const v of y) hist[v]!++;
  const light = percentile(hist, y.length, 0.5) > 150;
  const paper = Math.max(
    percentile(hist, y.length, light ? 0.85 : 0.995),
    percentile(hist, y.length, 0.005) + 32,
  );
  const ink = Math.min(percentile(hist, y.length, 0.005), paper - 32);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const x = Math.max(0, Math.min(1, (v - ink) / (paper - ink)));
    lut[v] = 255 * Math.pow(x, 1.25);
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]!]!;
    const g = lut[d[i + 1]!]!;
    const b = lut[d[i + 2]!]!;
    const l = luma709(r, g, b);
    d[i] = l + (r - l) * 1.15;
    d[i + 1] = l + (g - l) * 1.15;
    d[i + 2] = l + (b - l) * 1.15;
  }
}

/** Unsharp mask with a [1 2 1] ⊗ [1 2 1] blur, amount 0.7; edges repeat the border pixel. */
function sharpen(img: Rgba): void {
  const { width: w, height: h, data: d } = img;
  const src = d.slice();
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w * 4;
    const row = y * w * 4;
    const down = Math.min(h - 1, y + 1) * w * 4;
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - 1) * 4;
      const m = x * 4;
      const r = Math.min(w - 1, x + 1) * 4;
      for (let c = 0; c < 3; c++) {
        const v = src[row + m + c]!;
        const blur =
          (src[up + l + c]! +
            2 * src[up + m + c]! +
            src[up + r + c]! +
            2 * src[row + l + c]! +
            4 * v +
            2 * src[row + r + c]! +
            src[down + l + c]! +
            2 * src[down + m + c]! +
            src[down + r + c]!) /
          16;
        d[row + m + c] = v + 0.7 * (v - blur);
      }
    }
  }
}

/** Summed-area tables of v and v², with a zero first row and column. */
function integrals(v: Uint8Array, w: number, h: number) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < w; x++) {
      const p = v[y * w + x]!;
      rs += p;
      rq += p * p;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1]! + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1]! + rq;
    }
  }
  const out = { m: 0, s: 0 };
  /** Mean and standard deviation of the window of half-size `r` around (x, y); reuses `out`. */
  return (x: number, y: number, r: number) => {
    const x0 = Math.max(0, x - r);
    const y0 = Math.max(0, y - r);
    const x1 = Math.min(w, x + r + 1);
    const y1 = Math.min(h, y + r + 1);
    const n = (x1 - x0) * (y1 - y0);
    const box = (t: Float64Array) =>
      t[y1 * W + x1]! - t[y0 * W + x1]! - t[y1 * W + x0]! + t[y0 * W + x0]!;
    const m = box(sum) / n;
    out.m = m;
    out.s = Math.sqrt(Math.max(0, box(sq) / n - m * m));
    return out;
  };
}

const odd = (cssPx: number, pxPerCss: number) => Math.max(3, Math.round(cssPx * pxPerCss)) | 1;

/** Sauvola's threshold, with dark areas judged inverted so light-on-dark text becomes ink. */
const SAUVOLA_K = 0.2;
const SAUVOLA_R = 128;
const DARK_AREA = 110;

function blackWhite(img: Rgba, pxPerCss: number): void {
  const { width: w, height: h, data: d } = img;
  const y = lumaOf(img);
  const stats = integrals(y, w, h);
  const r = odd(25, pxPerCss) >> 1;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const { m, s } = stats(px, py, r);
      const t = 1 + SAUVOLA_K * (s / SAUVOLA_R - 1);
      const ink = m >= DARK_AREA ? y[i]! < m * t : 255 - y[i]! < (255 - m) * t;
      const out = ink ? 0 : 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = out;
    }
}

/**
 * Dark areas (mean brightness over ~40 CSS px below 100) get their brightness flipped in
 * YCbCr, which keeps the hue: white text on navy becomes navy-ish text on pale. Near-white
 * (≥ 235) becomes white.
 */
function inkSaver(img: Rgba, pxPerCss: number): void {
  const { width: w, height: h, data: d } = img;
  const y = lumaOf(img);
  const stats = integrals(y, w, h);
  const r = odd(41, pxPerCss) >> 1;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const j = i * 4;
      const R = d[j]!;
      const G = d[j + 1]!;
      const B = d[j + 2]!;
      const Y = luma709(R, G, B);
      if (stats(px, py, r).m < 100) {
        const dy = 255 - 2 * Y;
        d[j] = R + dy;
        d[j + 1] = G + dy;
        d[j + 2] = B + dy;
      } else if (Y >= 235) {
        d[j] = d[j + 1] = d[j + 2] = 255;
      }
    }
}
