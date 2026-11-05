import type { Heading, TextRun } from './hints.js';

/**
 * M8: the capture's text as Markdown, for notes and editing. Runs (DOM text, or recognised
 * text for pages that are pictures) become lines, lines become paragraphs at a vertical
 * gap, the page's h1–h3 become #-headings, bullet characters become list items, and
 * document pages are separated by a rule.
 */
/** The capture's text as structure, shared by Markdown and Word output. */
export type TextBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'item'; text: string }
  | { kind: 'pageBreak' };

export function textToMarkdown(
  runs: readonly TextRun[],
  headings: readonly Heading[] = [],
  pages: ReadonlyArray<{ y0: number; y1: number }> = [],
): string {
  const out = textBlocks(runs, headings, pages).map((b) => {
    if (b.kind === 'heading') return `${'#'.repeat(b.level)} ${escape(b.text)}`;
    if (b.kind === 'item') return `- ${escape(b.text)}`;
    if (b.kind === 'pageBreak') return '---';
    return escape(b.text);
  });
  return out.join('\n\n') + '\n';
}

export function textBlocks(
  runs: readonly TextRun[],
  headings: readonly Heading[] = [],
  pages: ReadonlyArray<{ y0: number; y1: number }> = [],
): TextBlock[] {
  // Whether the raw text had a space at either end: a run's box includes a trailing space,
  // so geometry alone can't tell "the reference." from "See section".
  const items = runs
    .map((r) => ({
      ...r,
      lead: /^\s/.test(r.text),
      trail: /\s$/.test(r.text),
      text: r.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((r) => r.text);
  // DOM order is reading order; recognised text has none, so it goes by position.
  const ordered = items.every((r) => r.order !== undefined)
    ? [...items].sort((a, b) => a.order! - b.order!)
    : [...items].sort((a, b) => lineKey(a) - lineKey(b) || a.rect.x - b.rect.x);

  interface Line {
    text: string;
    top: number;
    bottom: number;
    height: number;
    lastX: number;
    trail: boolean;
  }
  const lines: Line[] = [];
  for (const r of ordered) {
    const prev = lines.at(-1);
    const cy = r.rect.y + r.rect.height / 2;
    if (
      prev &&
      Math.abs(cy - (prev.top + prev.bottom) / 2) < 0.5 * Math.max(prev.height, r.rect.height) &&
      r.rect.x >= prev.lastX - 2
    ) {
      // Runs that touch with no space between (a link and the full stop after it) join
      // without one.
      const touching = r.rect.x - prev.lastX < 0.15 * r.fontSizePx && !prev.trail && !r.lead;
      prev.text = touching ? prev.text + r.text : join(prev.text, r.text);
      prev.trail = r.trail;
      prev.top = Math.min(prev.top, r.rect.y);
      prev.bottom = Math.max(prev.bottom, r.rect.y + r.rect.height);
      prev.lastX = r.rect.x + r.rect.width;
    } else {
      lines.push({
        text: r.text,
        top: r.rect.y,
        bottom: r.rect.y + r.rect.height,
        height: r.rect.height,
        lastX: r.rect.x + r.rect.width,
        trail: r.trail,
      });
    }
  }

  const pageOf = (y: number) => pages.findIndex((p) => y >= p.y0 && y < p.y1);
  const out: TextBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length)
      out.push({
        kind: 'paragraph',
        text: para.join(' ').replace(/ (?=[\u3000-\u9fff\uff00-\uffef])/g, ''),
      });
    para = [];
  };
  let prev: Line | null = null;
  for (const l of lines) {
    if (prev && pages.length && pageOf(l.top) !== pageOf(prev.top)) {
      flush();
      if (out.length && out.at(-1)!.kind !== 'pageBreak') out.push({ kind: 'pageBreak' });
      prev = null;
    }
    const heading = headings.find(
      (h) =>
        Math.abs(h.y - l.top) <= Math.max(4, l.height / 2) &&
        norm(h.text).startsWith(norm(l.text).slice(0, 12)),
    );
    const bullet = /^[•·▪◦‣–-]\s*/.exec(l.text);
    const gap = prev ? l.top - prev.bottom : 0;
    const size = prev ? Math.abs(l.height - prev.height) / Math.max(l.height, prev.height) : 0;
    if (heading) {
      flush();
      out.push({ kind: 'heading', level: heading.level, text: l.text });
      prev = l;
      continue;
    }
    if (bullet) {
      flush();
      out.push({ kind: 'item', text: l.text.slice(bullet[0].length) });
      prev = l;
      continue;
    }
    if (!prev || gap > 0.6 * l.height || size > 0.2) flush();
    para.push(l.text);
    prev = l;
  }
  flush();
  return out;
}

function lineKey(r: TextRun): number {
  return Math.round((r.rect.y + r.rect.height / 2) / Math.max(4, r.rect.height * 0.6));
}

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
function join(a: string, b: string): string {
  return CJK.test(a.at(-1)!) || CJK.test(b[0]!) ? a + b : `${a} ${b}`;
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Text that would read as Markdown syntax at the start of a line stays text. */
function escape(s: string): string {
  return s.replace(/^([#>]|\d+\.(?= )|[*+](?= ))/, '\\$1');
}
