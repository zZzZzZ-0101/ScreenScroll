import { DEFAULT_STYLE, type Annotation } from './annotations.js';
import type { Rect } from './geometry.js';
import type { TextRun } from './hints.js';

/**
 * M8 exam / handout mode: the document's own page numbers ("Page 5 of 12", "5 / 12",
 * "第 5 页 共 12 页", "- 5 -"), found in the top or bottom band of each document page.
 * Believed only when most pages have one and they count up by one, so a stray number in
 * a footer is not mistaken for numbering.
 */
export interface PageNumberMark {
  /** Index of the document page. */
  sheet: number;
  /** Where the number is, in capture CSS px. */
  rect: Rect;
  value: number;
  total: number | null;
  fontSizePx: number;
  /** As written, so renumbering keeps the wording ("Page 5 of 12" → "Page 1 of 6"). */
  text: string;
}

export interface PageNumbers {
  marks: PageNumberMark[];
  first: number;
  last: number;
  total: number | null;
}

const PATTERNS: Array<[RegExp, number]> = [
  // Most specific first: the score breaks ties between candidates on one page.
  [/^(?:page|p\.?)\s*(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})$/i, 3],
  [/^第\s*(\d{1,4})\s*页\s*[,，/]?\s*共\s*(\d{1,4})\s*页$/, 3],
  [/^(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})$/i, 2],
  [/^(?:page|p\.?)\s*(\d{1,4})$/i, 2],
  [/^第\s*(\d{1,4})\s*页$/, 2],
  [/^[-–—]\s*(\d{1,4})\s*[-–—]$/, 1],
  [/^(\d{1,4})$/, 0],
];

/** The band at the top and bottom of a page where numbers live. */
const BAND = 0.12;

export function findPageNumbers(
  sheets: ReadonlyArray<{ x0: number; x1: number; y0: number; y1: number }>,
  runs: readonly TextRun[],
): PageNumbers | null {
  if (sheets.length < 2) return null;
  const marks: PageNumberMark[] = [];
  sheets.forEach((s, i) => {
    const h = s.y1 - s.y0;
    let best: (PageNumberMark & { score: number }) | null = null;
    for (const r of runs) {
      const cy = r.rect.y + r.rect.height / 2;
      const cx = r.rect.x + r.rect.width / 2;
      if (cx < s.x0 || cx > s.x1 || cy < s.y0 || cy > s.y1) continue;
      if (cy > s.y0 + BAND * h && cy < s.y1 - BAND * h) continue;
      const text = r.text.replace(/\s+/g, ' ').trim();
      for (const [re, score] of PATTERNS) {
        const m = re.exec(text);
        if (!m) continue;
        const cand = {
          sheet: i,
          rect: r.rect,
          value: Number(m[1]),
          total: m[2] ? Number(m[2]) : null,
          fontSizePx: r.fontSizePx,
          text,
          score,
        };
        if (!best || cand.score > best.score) best = cand;
        break;
      }
    }
    if (best) {
      const { score: _score, ...mark } = best;
      marks.push(mark);
    }
  });
  if (marks.length < Math.max(2, Math.ceil(sheets.length * 0.6))) return null;
  // Counting up by one: the most common (value − page index) offset must hold for most.
  const offsets = new Map<number, number>();
  for (const m of marks) offsets.set(m.value - m.sheet, (offsets.get(m.value - m.sheet) ?? 0) + 1);
  const [offset, count] = [...offsets].sort((a, b) => b[1] - a[1])[0]!;
  if (count < Math.ceil(marks.length * 0.8)) return null;
  const kept = marks.filter((m) => m.value - m.sheet === offset);
  const totals = kept.map((m) => m.total).filter((t): t is number => t !== null);
  return {
    marks: kept,
    first: offset,
    last: offset + sheets.length - 1,
    total: totals.length ? Math.max(...totals) : null,
  };
}

/**
 * What hiding or renumbering the found numbers draws: a paper-coloured box over each, and
 * with renumbering the same wording with the page's place in this capture (1 … n) and the
 * capture's page count. Derived on export, never stored, so turning either off is exact.
 */
export function pageNumberAnnotations(
  found: PageNumbers | null,
  choice: { hide?: boolean; renumber?: boolean } | undefined,
  pageCount: number,
  paper = '#ffffff',
): Annotation[] {
  if (!found || !(choice?.hide || choice?.renumber)) return [];
  const out: Annotation[] = [];
  for (const m of found.marks) {
    const pad = 2;
    out.push({
      id: `pn-cover-${m.sheet}`,
      kind: 'cover',
      style: { ...DEFAULT_STYLE, color: paper },
      x: m.rect.x - pad,
      y: m.rect.y - pad,
      w: m.rect.width + 2 * pad,
      h: m.rect.height + 2 * pad,
    });
    if (!choice.renumber) continue;
    let k = 0;
    const text = m.text.replace(/\d+/g, () => String(k++ === 0 ? m.sheet + 1 : pageCount));
    const size = Math.max(8, m.fontSizePx);
    out.push({
      id: `pn-text-${m.sheet}`,
      kind: 'text',
      style: { ...DEFAULT_STYLE, color: '#333333', fontSize: size },
      // Centred where the old number was (text width estimated at 0.55 em per character).
      x: m.rect.x + m.rect.width / 2 - (text.length * size * 0.55) / 2,
      y: m.rect.y + (m.rect.height - size) / 2,
      text,
    });
  }
  return out;
}

/** A running header or footer: the same line in the same place on most pages. */
export interface RunningLine {
  text: string;
  band: 'top' | 'bottom';
  /** One box per page it is on (capture CSS px). */
  marks: Array<{ sheet: number; rect: Rect }>;
}

/**
 * Lines repeated word for word in the top or bottom band of at least 60 % of the pages
 * (and two), at about the same height within the page. Page numbers are found separately;
 * titles that only differ by a number ("Chapter 3") are not running lines.
 */
export function findRunningLines(
  sheets: ReadonlyArray<{ x0: number; x1: number; y0: number; y1: number }>,
  runs: readonly TextRun[],
): RunningLine[] {
  if (sheets.length < 2) return [];
  const groups = new Map<string, RunningLine & { at: number[] }>();
  sheets.forEach((s, i) => {
    const h = s.y1 - s.y0;
    for (const r of runs) {
      const cy = r.rect.y + r.rect.height / 2;
      const cx = r.rect.x + r.rect.width / 2;
      if (cx < s.x0 || cx > s.x1 || cy < s.y0 || cy > s.y1) continue;
      const band = cy <= s.y0 + BAND * h ? 'top' : cy >= s.y1 - BAND * h ? 'bottom' : null;
      if (!band) continue;
      const text = r.text.replace(/\s+/g, ' ').trim();
      if (text.length < 3 || PATTERNS.some(([re]) => re.test(text))) continue;
      const key = `${band}\u0000${text}`;
      const g = groups.get(key) ?? { text, band, marks: [], at: [] };
      if (g.marks.some((m) => m.sheet === i)) continue;
      g.marks.push({ sheet: i, rect: r.rect });
      g.at.push(cy - s.y0);
      groups.set(key, g);
    }
  });
  const need = Math.max(2, Math.ceil(sheets.length * 0.6));
  return [...groups.values()]
    .filter((g) => g.marks.length >= need && Math.max(...g.at) - Math.min(...g.at) <= 8)
    .map(({ at: _at, ...line }) => line);
}

/** Paper-coloured covers over running lines, drawn on export when the user hides them. */
export function runningLineAnnotations(
  lines: readonly RunningLine[],
  hide: boolean | undefined,
  paper = '#ffffff',
): Annotation[] {
  if (!hide) return [];
  return lines.flatMap((l, k) =>
    l.marks.map((m): Annotation => ({
      id: `rl-${k}-${m.sheet}`,
      kind: 'cover',
      style: { ...DEFAULT_STYLE, color: paper },
      x: m.rect.x - 2,
      y: m.rect.y - 2,
      w: m.rect.width + 4,
      h: m.rect.height + 4,
    })),
  );
}
