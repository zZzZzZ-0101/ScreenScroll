import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { emptyHints, type DomHints, type Interval } from '@scrollpress/core';

/**
 * Synthetic long captures with known ground truth (TESTING §1). Every text line's ink box is
 * measured from the rendered glyphs, so "no cut through text" can be checked exactly.
 */
export interface SynthDoc {
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Ink extent of every text line (y only; columns are unioned). */
  glyphs: Interval[];
  /** Where forced cuts are allowed: unbreakable elements taller than a page. */
  unbreakable: Interval[];
  /** DOM-like hints derived from the ground truth (lines, block ends, atomic photo). */
  hints: DomHints;
}

const WIDTH = 800;
const MAX_HEIGHT = 12_000;
const LATIN =
  'capture page break text line paragraph section frame document column reader margin table image render export layout pixel'.split(
    ' ',
  );
const CJK = '分页截图文字页面段落表格图片导出阅读边距标题列表代码'.split('');

interface Theme {
  bg: string;
  fg: string;
  muted: string;
}
const LIGHT: Theme = { bg: '#ffffff', fg: '#202124', muted: '#f1f3f4' };
const DARK: Theme = { bg: '#121212', fg: '#e8eaed', muted: '#2a2a2a' };

class Builder {
  readonly canvas = createCanvas(WIDTH, MAX_HEIGHT);
  readonly ctx: SKRSContext2D = this.canvas.getContext('2d');
  y = 24;
  readonly glyphs: Interval[] = [];
  readonly unbreakable: Interval[] = [];
  readonly hints: DomHints = emptyHints();
  private seed: number;

  constructor(
    readonly name: string,
    readonly theme: Theme,
    seed: number,
  ) {
    this.seed = seed * 2654435761 || 1; // spread small seeds; xorshift needs a non-zero state
    this.ctx.fillStyle = theme.bg;
    this.ctx.fillRect(0, 0, WIDTH, MAX_HEIGHT);
  }

  /** xorshift32: a plain LCG has strong lattice patterns at fixed strides, which made the
   * synthetic "photo" look like a few hundred colours to any sampler. */
  rand(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 2 ** 32;
  }

  words(n: number, cjk = false): string {
    if (cjk)
      return Array.from({ length: n * 2 }, () => CJK[Math.floor(this.rand() * CJK.length)]).join(
        '',
      );
    return Array.from({ length: n }, () => LATIN[Math.floor(this.rand() * LATIN.length)]).join(' ');
  }

  /** Draws one line of text and records its measured ink box. */
  line(
    text: string,
    x: number,
    baseline: number,
    size: number,
    colour = this.theme.fg,
    font = 'sans-serif',
  ) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = colour;
    ctx.fillText(text, x, baseline);
    const m = ctx.measureText(text);
    const y0 = Math.floor(baseline - m.actualBoundingBoxAscent) - 1;
    const y1 = Math.ceil(baseline + m.actualBoundingBoxDescent) + 1;
    this.glyphs.push({ y0, y1 });
    this.hints.forbidden.push({ y0, y1, kind: 'line' });
    this.hints.textRuns.push({
      text,
      rect: { x, y: y0, width: m.width, height: y1 - y0 },
      fontSizePx: size,
    });
  }

  heading(text: string) {
    this.y += 18;
    this.hints.blockEnds.push({ y: this.y - 8, kind: 'section' });
    const top = this.y;
    this.line(text, 40, this.y + 26, 26);
    this.y += 40;
    this.hints.keepWithNext.push({ y0: top, y1: this.y + 26 });
    this.hints.blockEnds.push({ y: this.y - 4, kind: 'paragraph' });
  }

  paragraph(
    lines: number,
    opts: { cjk?: boolean; x?: number; colour?: string; pitch?: number } = {},
  ) {
    const pitch = opts.pitch ?? 24;
    for (let i = 0; i < lines; i++) {
      this.line(
        this.words(opts.cjk ? 14 : 11, opts.cjk),
        opts.x ?? 40,
        this.y + 17,
        16,
        opts.colour,
        opts.cjk ? 'WenQuanYi Zen Hei' : 'sans-serif',
      );
      if (i < lines - 1) this.hints.blockEnds.push({ y: this.y + pitch - 2, kind: 'line' });
      this.y += pitch;
    }
    this.hints.blockEnds.push({ y: this.y + 4, kind: 'paragraph' });
    this.y += 14;
  }

  list(items: number) {
    for (let i = 0; i < items; i++) {
      this.ctx.fillStyle = this.theme.fg;
      this.ctx.fillRect(48, this.y + 10, 5, 5);
      this.line(this.words(8), 64, this.y + 17, 16);
      this.y += 26;
      this.hints.blockEnds.push({ y: this.y - 2, kind: 'listItem' });
    }
    this.y += 10;
  }

  band(colour: string, lines: number) {
    const top = this.y;
    this.y += 16;
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(0, top, WIDTH, lines * 24 + 32);
    this.paragraph(lines, { colour: '#ffffff' });
    this.y = top + lines * 24 + 32 + 16;
  }

  card(lines: number) {
    const top = this.y;
    const h = lines * 24 + 36;
    this.ctx.fillStyle = '#e8eaed';
    this.ctx.fillRect(30, top, WIDTH - 60, h);
    this.ctx.strokeStyle = '#9aa0a6';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(30.5, top + 0.5, WIDTH - 61, h - 1);
    this.y += 18;
    this.paragraph(lines, { x: 50, colour: '#202124' });
    this.y = top + h + 16;
  }

  table(rows: number) {
    const cols = [30, 230, 470, 770];
    const rowH = 30;
    const top = this.y;
    for (let r = 0; r < rows; r++) {
      const y = top + r * rowH;
      this.ctx.fillStyle = r === 0 ? '#c8e6e4' : r % 2 ? '#ffffff' : '#f3f6f6';
      this.ctx.fillRect(cols[0]!, y, cols[3]! - cols[0]!, rowH);
      for (let c = 0; c < 3; c++) this.line(this.words(2), cols[c]! + 10, y + 20, 14, '#202124');
      this.hints.blockEnds.push({ y: y + rowH, kind: 'tableRow' });
    }
    this.ctx.fillStyle = '#5f6368';
    for (let r = 0; r <= rows; r++)
      this.ctx.fillRect(cols[0]!, top + r * rowH, cols[3]! - cols[0]!, 1);
    for (const x of cols) this.ctx.fillRect(x, top, 1, rows * rowH + 1);
    this.y = top + rows * rowH + 24;
  }

  code(lines: number) {
    const top = this.y;
    const h = lines * 20 + 24;
    this.ctx.fillStyle = this.theme.muted;
    this.ctx.fillRect(30, top, WIDTH - 60, h);
    this.y += 12;
    for (let i = 0; i < lines; i++) {
      const indent = (i % 4) * 16;
      this.line(
        `${'fn'.repeat(1 + (i % 3))}(${this.words(3).replace(/ /g, ', ')});`,
        46 + indent,
        this.y + 14,
        13,
        this.theme.fg,
        'monospace',
      );
      this.y += 20;
    }
    this.y = top + h + 16;
    this.hints.blockEnds.push({ y: this.y - 8, kind: 'paragraph' });
  }

  /** A photo: noise everywhere, so it has no clean row to cut at. */
  photo(height: number) {
    const top = this.y;
    const img = this.ctx.createImageData(WIDTH - 80, height);
    for (let i = 0; i < img.data.length; i += 4) {
      // Independent channels: thousands of distinct colours, like a real photo.
      img.data[i] = Math.floor(this.rand() * 256);
      img.data[i + 1] = Math.floor(this.rand() * 256);
      img.data[i + 2] = Math.floor(this.rand() * 256);
      img.data[i + 3] = 255;
    }
    this.ctx.putImageData(img, 40, top);
    this.unbreakable.push({ y0: top, y1: top + height });
    this.hints.forbidden.push({ y0: top, y1: top + height, kind: 'atomic' });
    this.y = top + height + 20;
  }

  /** Two columns whose baselines don't line up. */
  twoColumns(lines: number) {
    const top = this.y;
    for (let i = 0; i < lines; i++) this.line(this.words(5), 40, top + 17 + i * 22, 15);
    for (let i = 0; i < Math.floor((lines * 22) / 29); i++)
      this.line(this.words(5), 420, top + 24 + i * 29, 18);
    this.y = top + lines * 22 + 24;
    this.hints.blockEnds.push({ y: this.y - 10, kind: 'paragraph' });
  }

  scrollbar() {
    this.ctx.fillStyle = '#c1c1c1';
    this.ctx.fillRect(WIDTH - 5, 0, 5, this.y);
  }

  async finish(jpegQuality?: number): Promise<SynthDoc> {
    const height = this.y + 24;
    let ctx = this.ctx;
    if (jpegQuality !== undefined) {
      const jpeg = await this.canvas.encode('jpeg', jpegQuality);
      const img = await loadImage(jpeg);
      const c2 = createCanvas(WIDTH, MAX_HEIGHT);
      ctx = c2.getContext('2d');
      ctx.drawImage(img, 0, 0);
    }
    const data = ctx.getImageData(0, 0, WIDTH, height).data;
    this.hints.forbidden.sort((a, b) => a.y0 - b.y0);
    return {
      name: this.name,
      width: WIDTH,
      height,
      rgba: new Uint8ClampedArray(data),
      glyphs: this.glyphs,
      unbreakable: this.unbreakable,
      hints: this.hints,
    };
  }
}

function articleBody(b: Builder, cjk = false) {
  for (let s = 0; s < 6; s++) {
    b.heading(`Section ${s + 1} ${b.words(2)}`);
    for (let p = 0; p < 3; p++)
      b.paragraph(3 + Math.floor(b.rand() * 6), { cjk: cjk && p % 2 === 1 });
    if (s % 2 === 1) b.list(4);
  }
}

/** All fixtures listed in TESTING §1. */
export async function synthFixtures(): Promise<SynthDoc[]> {
  const docs: Array<Promise<SynthDoc>> = [];
  const make = (
    name: string,
    theme: Theme,
    seed: number,
    body: (b: Builder) => void,
    jpeg?: number,
  ) => {
    const b = new Builder(name, theme, seed);
    body(b);
    docs.push(b.finish(jpeg));
  };
  make('latin-cjk', LIGHT, 1, (b) => articleBody(b, true));
  make('dark-mode', DARK, 2, (b) => articleBody(b));
  make('bands-cards', LIGHT, 3, (b) => {
    for (let i = 0; i < 8; i++) {
      b.paragraph(4);
      b.band(i % 2 ? '#0e7c7b' : '#6a4fb3', 3);
      b.card(5);
    }
  });
  make('tables', LIGHT, 4, (b) => {
    b.paragraph(3);
    b.table(90);
    b.paragraph(3);
    b.table(40);
  });
  make('tall-code', LIGHT, 5, (b) => {
    b.paragraph(4);
    b.code(150); // ≈ 3000 px: taller than a page, with line gaps
    b.paragraph(4);
  });
  make('tall-photo', LIGHT, 6, (b) => {
    b.paragraph(5);
    b.photo(3200); // taller than every page setting: forced cuts
    b.paragraph(5);
  });
  make('two-column', LIGHT, 7, (b) => {
    for (let i = 0; i < 5; i++) {
      b.heading(`Columns ${i + 1}`);
      b.twoColumns(18);
    }
  });
  make('jpeg-noise', LIGHT, 8, (b) => articleBody(b), 60);
  make('scrollbar', LIGHT, 9, (b) => {
    articleBody(b);
    b.scrollbar();
  });
  return Promise.all(docs);
}
