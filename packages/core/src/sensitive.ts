import type { Rect } from './geometry.js';

/**
 * Auto-redact (M6): personal data in the page's own text, offered as a checklist to blur.
 * Patterns are deliberately plain and checked where a check digit exists (cards, Chinese ID
 * numbers), so ordinary numbers rarely show up; the user unticks whatever is not private.
 */
export type SensitiveKind = 'email' | 'phone' | 'card' | 'id';

export interface SensitiveMatch {
  kind: SensitiveKind;
  text: string;
  /** Index of the text run, and the match's character range in it. */
  run: number;
  start: number;
  end: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const CN_ID = /\b\d{17}[\dXx]\b/g;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,4}/g;

/** Luhn (ISO/IEC 7812) check digit, as every payment card number carries. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** GB 11643-1999 check character of an 18-character resident ID number. */
export function cnIdValid(id: string): boolean {
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let s = 0;
  for (let i = 0; i < 17; i++) s += Number(id[i]) * w[i]!;
  return '10X98765432'[s % 11] === id[17]!.toUpperCase();
}

export function findSensitive(runs: readonly { text: string }[]): SensitiveMatch[] {
  const out: SensitiveMatch[] = [];
  runs.forEach(({ text }, run) => {
    const taken: [number, number][] = [];
    const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
    const add = (kind: SensitiveKind, m: RegExpExecArray) => {
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) return;
      taken.push([start, end]);
      out.push({ kind, text: m[0], run, start, end });
    };
    for (const m of text.matchAll(EMAIL)) add('email', m);
    for (const m of text.matchAll(CN_ID)) if (cnIdValid(m[0])) add('id', m);
    for (const m of text.matchAll(CARD)) {
      const d = m[0].replace(/\D/g, '');
      if (d.length >= 13 && d.length <= 19 && luhn(d)) add('card', m);
    }
    for (const m of text.matchAll(PHONE)) {
      const d = m[0].replace(/\D/g, '');
      // 9–15 digits (E.164 allows 15); a date (2026-10-31) or a year range has fewer.
      if (d.length >= 9 && d.length <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(m[0].trim()))
        add('phone', m);
    }
  });
  return out.sort((a, b) => a.run - b.run || a.start - b.start);
}

/**
 * Where a match sits in its line. Runs carry one box per line, so the x range comes from
 * the width of the text before and through the match, as a share of the whole line's:
 * measured with `measure` (a canvas at the run's font size) when given, else by character
 * count. Either way it is widened by half the font size each side: the page's own font
 * differs from the measuring one, and a redaction must cover rather than fit.
 */
export function matchRect(
  run: { text: string; rect: Rect; fontSizePx: number },
  m: { start: number; end: number },
  measure: (text: string) => number = (t) => t.length,
): Rect {
  const all = Math.max(1e-6, measure(run.text));
  const at = (i: number) => (run.rect.width * measure(run.text.slice(0, i))) / all;
  const pad = run.fontSizePx / 2;
  const x0 = Math.max(run.rect.x, run.rect.x + at(m.start) - pad);
  const x1 = Math.min(run.rect.x + run.rect.width, run.rect.x + at(m.end) + pad);
  return { x: x0, y: run.rect.y - 2, width: x1 - x0, height: run.rect.height + 4 };
}
