import { describe, expect, it } from 'vitest';
import type { GreyImage } from '../src/image.js';
import {
  analyzeRows,
  estimateLineGap,
  findGaps,
  isSafeAt,
  leastDamage,
  nearestSafe,
  pixelCandidates,
  RowAnalyzer,
} from '../src/rows.js';

/** Tiny painter for grey test images. */
function canvas(width: number, height: number, bg: number) {
  const data = new Uint8Array(width * height).fill(bg);
  const img: GreyImage = { width, height, data };
  return {
    img,
    fill(x0: number, y0: number, x1: number, y1: number, v: number) {
      for (let y = y0; y < y1; y++) data.fill(v, y * width + x0, y * width + x1);
    },
    /** Text-like line: alternating dark/light runs. */
    text(y0: number, h: number, ink: number) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = 20; x < width - 20; x++) if (x % 7 < 4) data[y * width + x] = ink;
      }
    },
  };
}

describe('row uniformity', () => {
  it('marks text rows unsafe and blank rows safe on white', () => {
    const c = canvas(200, 40, 255);
    c.text(10, 8, 20);
    const p = analyzeRows(c.img);
    expect(Array.from(p.safe.slice(8, 20))).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('works in dark mode and on coloured bands (uniform vs the row’s own mode)', () => {
    const c = canvas(200, 60, 30);
    c.fill(0, 30, 200, 60, 140); // grey card
    c.text(10, 6, 230); // light text on dark
    c.text(40, 6, 20); // dark text on grey
    const p = analyzeRows(c.img);
    expect(p.safe[5]).toBe(1);
    expect(p.safe[12]).toBe(0);
    expect(p.safe[35]).toBe(1);
    expect(p.safe[42]).toBe(0);
  });

  it('tolerates JPEG-like noise up to τ', () => {
    const c = canvas(200, 20, 240);
    let s = 7;
    for (let i = 0; i < c.img.data.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      c.img.data[i] = 240 + ((s >>> 16) % 17) - 8; // ±8
    }
    expect(Array.from(analyzeRows(c.img).safe).every((v) => v === 1)).toBe(true);
  });

  it('ignores a thin strip at the edges (scrollbar, frame border)', () => {
    const c = canvas(200, 10, 255);
    c.fill(196, 0, 200, 10, 120);
    expect(Array.from(analyzeRows(c.img).safe).every((v) => v === 1)).toBe(true);
  });

  it('marks rows with only vertical rules as rule-safe', () => {
    const c = canvas(400, 80, 255);
    for (const x of [50, 200, 350]) c.fill(x, 0, x + 1, 80, 0); // table borders
    c.fill(0, 40, 400, 41, 0); // a horizontal rule doesn't break the vertical ones
    c.text(25, 6, 0);
    const p = analyzeRows(c.img);
    expect(p.safe[15]).toBe(2);
    expect(p.safe[45]).toBe(2);
    expect(p.safe[27]).toBe(0);
    expect(p.safe[3]).toBe(0); // too close to the top: the stroke can't be confirmed
    expect(p.safe[76]).toBe(0); // too close to the bottom
  });

  it('does not mistake text descenders for table rules', () => {
    const c = canvas(400, 60, 255);
    c.text(20, 10, 0);
    // A few descender stems hanging 4 rows below the line.
    for (const x of [60, 130, 251]) c.fill(x, 30, x + 2, 34, 0);
    const p = analyzeRows(c.img);
    expect(Array.from(p.safe.slice(30, 34))).toEqual([0, 0, 0, 0]);
  });
});

describe('gaps and candidates', () => {
  // Paragraphs of 4 lines (8 rows tall, 6-row line gaps) separated by 10-row gaps,
  // and a 60-row section gap.
  function doc() {
    const c = canvas(300, 400, 255);
    let y = 10;
    const lines: number[] = [];
    for (let para = 0; para < 5; para++) {
      for (let l = 0; l < 4; l++) {
        c.text(y, 8, 0);
        lines.push(y);
        y += 14;
      }
      y += para === 1 ? 60 : 4; // paragraph gap 10 rows (≈1.7× the line gap)
    }
    return { img: c.img, lines };
  }

  it('estimates the line gap', () => {
    const p = analyzeRows(doc().img);
    expect(estimateLineGap(p)).toBe(6);
  });

  it('grades gaps by height and cuts at their centre', () => {
    const p = analyzeRows(doc().img);
    const cands = pixelCandidates(p);
    const kinds = cands.map((c) => c.kind);
    expect(kinds.filter((k) => k === 'section')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'paragraph')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'line')).toHaveLength(15);
    const section = cands.find((c) => c.kind === 'section')!;
    expect(section.y).toBe((section.y0 + section.y1) / 2);
  });

  it('streams in chunks with the same result as one pass', () => {
    const { img } = doc();
    const whole = analyzeRows(img);
    const a = new RowAnalyzer(img.width, 1);
    for (let y = 0; y < img.height; y += 37) {
      const h = Math.min(37, img.height - y);
      a.push({
        width: img.width,
        height: h,
        data: img.data.subarray(y * img.width, (y + h) * img.width),
      });
    }
    expect(a.finish()).toEqual(whole);
  });

  it('scales rows to CSS px', () => {
    const p = analyzeRows(doc().img, 2); // 2 analysis rows per CSS px
    for (const c of pixelCandidates(p)) expect(c.y).toBeLessThan(200);
  });

  it('finds gaps as maximal safe runs', () => {
    const c = canvas(100, 20, 255);
    c.text(5, 3, 0);
    c.text(12, 3, 0);
    expect(findGaps(analyzeRows(c.img))).toEqual([
      { r0: 0, r1: 5, rule: false },
      { r0: 8, r1: 12, rule: false },
      { r0: 15, r1: 20, rule: false },
    ]);
  });
});

describe('safety and least damage', () => {
  it('nearestSafe finds the closest clean row within the radius', () => {
    const c = canvas(100, 30, 255);
    c.text(10, 10, 0);
    const p = analyzeRows(c.img);
    expect(isSafeAt(p, 15)).toBe(false);
    expect(nearestSafe(p, 12, 4)).toBe(9);
    expect(nearestSafe(p, 15, 2)).toBeNull();
  });

  it('leastDamage prefers smooth rows inside a photo-like block', () => {
    const c = canvas(100, 100, 255);
    // Gradient block with one flat band at rows 60–64.
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) c.img.data[y * 100 + x] = (x * 3 + y * 40) % 256;
    }
    c.fill(0, 60, 100, 65, 128);
    const p = analyzeRows(c.img);
    const y = leastDamage(p, 40, 90);
    expect(y).toBeGreaterThanOrEqual(61);
    expect(y).toBeLessThanOrEqual(64);
  });
});

describe('heading heuristic', () => {
  it('penalises the gap right below a heading-like line', () => {
    const c = canvas(300, 400, 255);
    let y = 10;
    const body = () => {
      for (let l = 0; l < 4; l++) {
        c.text(y, 8, 0);
        y += 14;
      }
      y += 8;
    };
    body();
    y += 30;
    const headingTop = y;
    c.text(y, 16, 0); // heading: twice as tall as a body line
    y += 16 + 14;
    body();
    body();
    const cands = pixelCandidates(analyzeRows(c.img));
    const below = cands.find((k) => k.y0 >= headingTop + 16 && k.y0 < headingTop + 20)!;
    const above = cands.find((k) => k.y1 === headingTop)!;
    expect(below.badness).toBeGreaterThanOrEqual(40);
    expect(above.badness).toBeLessThan(2);
  });
});
