import { describe, expect, it } from 'vitest';
import { cnIdValid, findSensitive, luhn, matchRect } from '../src/sensitive.js';

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
