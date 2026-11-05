import { describe, expect, it } from 'vitest';
import { findPageNumbers, pageNumberAnnotations, type TextRun } from '../src/index.js';

const sheets = Array.from({ length: 6 }, (_, i) => ({
  x0: 100,
  x1: 860,
  y0: i * 1100,
  y1: i * 1100 + 1075,
}));
const run = (text: string, y: number, x = 450): TextRun => ({
  text,
  rect: { x, y, width: 60, height: 14 },
  fontSizePx: 12,
});
const body = sheets.flatMap((s, i) => [
  run(`Document page ${i + 1}`, s.y0 + 60),
  run('12', s.y0 + 500),
]);

describe('findPageNumbers', () => {
  it('finds "Page N of M" in the footer band, counting up by one', () => {
    const runs = [...body, ...sheets.map((s, i) => run(`Page ${i + 5} of 12`, s.y1 - 40))];
    const pn = findPageNumbers(sheets, runs)!;
    expect(pn.marks).toHaveLength(6);
    expect([pn.first, pn.last, pn.total]).toEqual([5, 10, 12]);
  });

  it('reads Chinese, slashes and dashes, in the header band too', () => {
    for (const f of [
      (n: number) => `第 ${n} 页 共 6 页`,
      (n: number) => `${n} / 6`,
      (n: number) => `- ${n} -`,
    ]) {
      const runs = [...body, ...sheets.map((s, i) => run(f(i + 1), s.y0 + 20))];
      expect(findPageNumbers(sheets, runs)?.first).toBe(1);
    }
  });

  it('ignores numbers in the body and numbers that do not count up', () => {
    expect(findPageNumbers(sheets, body)).toBeNull();
    const runs = [...body, ...sheets.map((s) => run('7', s.y1 - 40))];
    expect(findPageNumbers(sheets, runs)).toBeNull();
  });

  it('allows one page without a number', () => {
    const runs = [...body, ...sheets.slice(1).map((s, i) => run(`${i + 2}`, s.y1 - 40))];
    const pn = findPageNumbers(sheets, runs)!;
    expect(pn.marks).toHaveLength(5);
    expect([pn.first, pn.last]).toEqual([1, 6]);
  });
});

describe('pageNumberAnnotations', () => {
  const runs = [...body, ...sheets.map((s, i) => run(`Page ${i + 5} of 12`, s.y1 - 40))];
  const pn = findPageNumbers(sheets, runs);
  it('draws nothing unless asked', () => {
    expect(pageNumberAnnotations(pn, undefined, 6)).toEqual([]);
    expect(pageNumberAnnotations(pn, { hide: false, renumber: false }, 6)).toEqual([]);
  });
  it('covers each number; renumbering keeps the wording', () => {
    expect(pageNumberAnnotations(pn, { hide: true }, 6).map((a) => a.kind)).toEqual(
      Array(6).fill('cover'),
    );
    const texts = pageNumberAnnotations(pn, { renumber: true }, 6)
      .filter((a) => a.kind === 'text')
      .map((a) => (a.kind === 'text' ? a.text : ''));
    expect(texts).toEqual([
      'Page 1 of 6',
      'Page 2 of 6',
      'Page 3 of 6',
      'Page 4 of 6',
      'Page 5 of 6',
      'Page 6 of 6',
    ]);
  });
});
