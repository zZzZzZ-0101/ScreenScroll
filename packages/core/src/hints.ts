import type { Interval, Px, Rect } from './geometry.js';

/** Why an interval must not be cut (CAPTURE §11). Images may become opaque when tall. */
export type ForbiddenKind = 'line' | 'atomic' | 'image';

export interface Forbidden extends Interval {
  kind: ForbiddenKind;
}

export type BoundaryKind = 'section' | 'paragraph' | 'listItem' | 'tableRow' | 'line';

export interface Boundary {
  y: Px;
  kind: BoundaryKind;
}

export interface TableInfo {
  y0: Px;
  y1: Px;
  rowEnds: Px[];
  headerHeight: Px;
}

export interface TextRun {
  text: string;
  rect: Rect;
  fontSizePx: number;
  /** Position of the text node in DOM order, for reading order (PDF_OUTPUT §2). */
  order?: number;
}

export interface LinkRect {
  href: string;
  rect: Rect;
  /** For links to an anchor on the captured page: the target's y, for an in-PDF jump. */
  targetY?: Px;
}

/** h1–h3 for PDF bookmarks (PDF_OUTPUT §5). */
export interface Heading {
  level: 1 | 2 | 3;
  text: string;
  y: Px;
}

/** All coordinates are CSS px relative to the captured region's top-left (document coords). */
export interface DomHints {
  forbidden: Forbidden[];
  blockEnds: Boundary[];
  keepWithNext: Interval[];
  opaque: Rect[];
  tables: TableInfo[];
  textRuns: TextRun[];
  links: LinkRect[];
  headings: Heading[];
}

export function emptyHints(): DomHints {
  return {
    forbidden: [],
    blockEnds: [],
    keepWithNext: [],
    opaque: [],
    tables: [],
    textRuns: [],
    links: [],
    headings: [],
  };
}

/**
 * Combines per-frame hints. Overlapping frames report the same lines, links and boundaries
 * again, so entries are de-duplicated on rounded geometry (frames can disagree by
 * sub-pixel amounts). Output is sorted, so merging is deterministic.
 */
export function mergeHints(parts: readonly DomHints[]): DomHints {
  const out = emptyHints();
  const r = (v: number) => Math.round(v);
  const rk = (x: Rect) => `${r(x.x)},${r(x.y)},${r(x.width)},${r(x.height)}`;
  for (const p of parts) {
    out.forbidden.push(...p.forbidden);
    out.blockEnds.push(...p.blockEnds);
    out.keepWithNext.push(...p.keepWithNext);
    out.opaque.push(...p.opaque);
    out.tables.push(...p.tables);
    out.textRuns.push(...p.textRuns);
    out.links.push(...p.links);
    // Frames stored before headings existed have none.
    out.headings.push(...(p.headings ?? []));
  }
  return {
    forbidden: uniq(out.forbidden, (f) => `${f.kind}:${r(f.y0)}:${r(f.y1)}`).sort(
      (a, b) => a.y0 - b.y0 || a.y1 - b.y1 || a.kind.localeCompare(b.kind),
    ),
    blockEnds: uniq(out.blockEnds, (b) => `${b.kind}:${r(b.y)}`).sort(
      (a, b) => a.y - b.y || a.kind.localeCompare(b.kind),
    ),
    keepWithNext: uniq(out.keepWithNext, (k) => `${r(k.y0)}:${r(k.y1)}`).sort(
      (a, b) => a.y0 - b.y0,
    ),
    opaque: uniq(out.opaque, rk).sort(byRect),
    tables: uniq(out.tables, (t) => `${r(t.y0)}:${r(t.y1)}`).sort((a, b) => a.y0 - b.y0),
    textRuns: uniq(out.textRuns, (t) => `${rk(t.rect)}:${t.text}`).sort((a, b) =>
      byRect(a.rect, b.rect),
    ),
    links: uniq(out.links, (l) => `${rk(l.rect)}:${l.href}`).sort((a, b) => byRect(a.rect, b.rect)),
    headings: uniq(out.headings, (h) => `${h.level}:${r(h.y)}:${h.text}`).sort((a, b) => a.y - b.y),
  };
}

function uniq<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function byRect(a: Rect, b: Rect): number {
  return a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;
}
