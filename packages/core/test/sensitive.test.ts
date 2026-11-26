import { describe, expect, it } from 'vitest';
import type { TextRun } from '../src/hints.js';
import { cnIdValid, findSensitive, findTextMatches, luhn, matchRect } from '../src/sensitive.js';

const kinds = (text: string) => findSensitive([{ text }]).map((m) => [m.kind, m.text]);

describe('auto-redact: personal data in text', () => {
  it('emails', () => {
    expect(kinds('Write to ana.lee+news@mail.example.co.uk today')).toEqual([
      ['email', 'ana.lee+news@mail.example.co.uk'],
    ]);
  });
  it('card numbers only when the Luhn digit holds', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(kinds('Card 4111 1111 1111 1111 on file')).toEqual([['card', '4111 1111 1111 1111']]);
    // One digit off: not a card. Its 16 digits are too many for a phone number too.
    expect(kinds('Order 4111 1111 1111 1112')).toEqual([]);
  });
  it('Chinese resident ID numbers with a valid check character', () => {
    expect(cnIdValid('11010519491231002X')).toBe(true);
    expect(kinds('身份证号 11010519491231002X 已登记')).toEqual([['id', '11010519491231002X']]);
    expect(kinds('编号 110105194912310021')).toEqual([]);
  });
  it('phone numbers in common shapes', () => {
    expect(kinds('Call +44 20 7946 0958 or (555) 123-4567')).toEqual([
      ['phone', '+44 20 7946 0958'],
      ['phone', '(555) 123-4567'],
    ]);
    expect(kinds('手机 13812345678')).toEqual([['phone', '13812345678']]);
  });
  it('leaves dates, years, prices and short numbers alone', () => {
    expect(kinds('On 2026-10-31, 1999–2024, $1,299.00, page 12 of 340, v1.2.3')).toEqual([]);
  });
  it('places the match in its line, padded to cover', () => {
    const run = {
      text: 'Mail: a@b.co',
      rect: { x: 100, y: 50, width: 120, height: 20 },
      fontSizePx: 16,
    };
    const [m] = findSensitive([run]);
    const r = matchRect(run, m!);
    // Characters 6–12 of 12 → x 160–220, padded 8 → 152–220 (clamped to the line).
    expect(r).toEqual({ x: 152, y: 48, width: 68, height: 24 });
    // Measured: a wide prefix pushes the match right. 'Mail: ' is 60 of 120 units → x 160.
    const w = (t: string) => [...t].reduce((n, c) => n + (c === 'M' ? 15 : 9.5), 0);
    const r2 = matchRect(run, m!, w);
    expect(r2.x).toBeCloseTo(100 + (120 * w('Mail: ')) / w(run.text) - 8, 6);
  });
});

const mkRun = (text: string, y = 100, x = 20, width = 200, height = 18): TextRun => ({
  text,
  rect: { x, y, width, height },
  fontSizePx: 14,
});

describe('findTextMatches', () => {
  it('returns empty array for empty or whitespace queries', () => {
    const runs = [mkRun('Hello world')];
    expect(findTextMatches(runs, '')).toEqual([]);
    expect(findTextMatches(runs, '   \t\n  ')).toEqual([]);
  });

  it('matches case-insensitively across multiple runs and multiple hits per run', () => {
    const runs = [
      mkRun('Acme Corp sells ACME tools', 100, 10, 260),
      mkRun('Contact acme support', 140, 10, 200),
    ];
    const matches = findTextMatches(runs, 'acme');
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => [m.runIndex, m.text])).toEqual([
      [0, 'Acme'],
      [0, 'ACME'],
      [1, 'acme'],
    ]);
    // Second match in run 0 sits to the right of the first match.
    expect(matches[1]!.rect.x).toBeGreaterThan(matches[0]!.rect.x);
    expect(matches[2]!.rect.y).toBe(138);
  });

  it('respects wholeWord for Latin words and punctuation boundaries', () => {
    const runs = [
      mkRun('The cat sat on a category of scat (cat).', 100),
      mkRun('Use C++ now, not myC++.', 140),
    ];
    const cat = findTextMatches(runs, 'cat', { wholeWord: true });
    expect(cat).toHaveLength(2);
    expect(cat.every((m) => m.runIndex === 0 && m.text === 'cat')).toBe(true);
    const cpp = findTextMatches(runs, 'C++', { wholeWord: true });
    expect(cpp).toHaveLength(1);
    expect(cpp[0]!.runIndex).toBe(1);
    expect(cpp[0]!.text).toBe('C++');
  });

  it('finds CJK phrases and handles mixed scripts', () => {
    const runs = [mkRun('机密文件：本项目属于内部机密资料', 200, 40, 320)];
    const hits = findTextMatches(runs, '机密');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.text).toBe('机密');
    expect(hits[1]!.rect.x).toBeGreaterThan(hits[0]!.rect.x);
  });

  it('escapes regex metacharacters safely', () => {
    const runs = [
      mkRun('Price is $19.99 (a+b)*[c]? ^end\\path', 100),
      mkRun('Price is $19X99', 140),
    ];
    const m1 = findTextMatches(runs, '$19.99');
    expect(m1).toHaveLength(1);
    expect(m1[0]!.runIndex).toBe(0);
    const m2 = findTextMatches(runs, '(a+b)*[c]?');
    expect(m2).toHaveLength(1);
    expect(m2[0]!.text).toBe('(a+b)*[c]?');
    const m3 = findTextMatches(runs, '^end\\path');
    expect(m3).toHaveLength(1);
    expect(m3[0]!.text).toBe('^end\\path');
  });

  it('skips zero-area and invalid rects', () => {
    const runs: TextRun[] = [
      { text: 'secret', rect: { x: 0, y: 0, width: 0, height: 16 }, fontSizePx: 14 },
      { text: 'secret', rect: { x: 0, y: 0, width: 80, height: 0 }, fontSizePx: 14 },
      { text: 'secret', rect: { x: Number.NaN, y: 0, width: 80, height: 16 }, fontSizePx: 14 },
      mkRun('secret valid', 50),
    ];
    const matches = findTextMatches(runs, 'secret');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.runIndex).toBe(3);
  });

  it('forwards optional measure callback to matchRect', () => {
    const run = mkRun('WWabc', 50, 0, 100, 20);
    const hits = findTextMatches([run], 'abc', {
      measure: () => (s) => [...s].reduce((acc, ch) => acc + (ch === 'W' ? 30 : 10), 0),
    });
    expect(hits).toHaveLength(1);
    // 'WW' is 60 / 90 of 100 = 66.67, minus pad 7 = 59.67
    expect(hits[0]!.rect.x).toBeCloseTo((100 * 60) / 90 - 7, 5);
  });
});
