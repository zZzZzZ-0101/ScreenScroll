/**
 * A text watermark across the page (CamScanner-style document edits). pdf-lib free, so the
 * Studio and tests can use it without the PDF code.
 */
export interface Watermark {
  text: string;
  /** 0.05 (faint) … 0.6. */
  opacity: number;
  sizePt: number;
  /** Degrees, counter-clockwise; 45 runs corner to corner on portrait paper. */
  angle: number;
  color: string;
  /** Which pages: every page, the first only, or a list like "1-3, 5". */
  pages: 'all' | 'first' | string;
}

export const NO_WATERMARK: Watermark = {
  text: '',
  opacity: 0.15,
  sizePt: 60,
  angle: 45,
  color: '#808080',
  pages: 'all',
};

/** "1-3, 5, 8-" → [1,2,3,5,8,…,max]; out-of-range and malformed parts are ignored. */
export function parsePageList(list: string, max: number): number[] {
  const out = new Set<number>();
  // "3 - 5" is one range: join the dash to its numbers before splitting on spaces.
  for (const part of list.replace(/\s*([-–~])\s*/g, '$1').split(/[,，;；、\s]+/)) {
    const m = /^(\d*)[-–~](\d*)$/.exec(part) ?? /^(\d+)$/.exec(part);
    // A dash alone names no pages.
    if (!m || (m[1] === '' && m[2] === '')) continue;
    let a = m[1] === '' ? 1 : Number(m[1]);
    let b = m[2] === undefined ? a : m[2] === '' ? Infinity : Number(m[2]);
    // "5-3" means 3 to 5; an open end ("8-", "-2") is never turned around.
    if (m[1] !== '' && m[2] && a > b) [a, b] = [b, a];
    for (let p = Math.max(1, a); p <= Math.min(max, b); p++) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

/** Whether page `n` (1-based) of `count` gets the watermark. */
export function watermarkOn(w: Watermark, n: number, count: number): boolean {
  if (!w.text.trim()) return false;
  if (w.pages === 'all') return true;
  if (w.pages === 'first') return n === 1;
  return parsePageList(w.pages, count).includes(n);
}

/** #rrggbb → 0…1 channels; anything else is mid grey. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  return [1, 2, 3].map((i) => parseInt(m[i]!, 16) / 255) as [number, number, number];
}
