import type { Boundary, BoundaryKind, DomHints, Rect } from '@scrollpress/core';
import { emptyHints } from '@scrollpress/core';

/**
 * Collects DOM hints (CAPTURE §11) for the part of the region visible in the current frame.
 * Runs per frame because virtualised lists recycle nodes. All reads, no writes.
 * Coordinates are region-relative CSS px: x from the crop's left edge, y from the top of
 * the scrollable content.
 */
export interface CollectContext {
  root: Element;
  /** Crop rect in viewport CSS px. */
  crop: Rect;
  /** Current scroll offset of the target. */
  offset: number;
  /** Keys already sent in earlier frames, so overlapping frames don't resend them. */
  seen: Set<string>;
  /** Skip text runs (the most expensive part) once a frame blows the time budget. */
  skipTextRuns: boolean;
  /** DOM order of text nodes, numbered on first sight; stable across frames. */
  order: WeakMap<Node, number>;
  nextOrder: number;
}

const ATOMIC = 'img, svg, video, picture, input, textarea, select, button, math, tr';
const OPAQUE = 'canvas, iframe, embed, object';
const BLOCK_KIND: Record<string, BoundaryKind> = {
  P: 'paragraph',
  BLOCKQUOTE: 'paragraph',
  PRE: 'paragraph',
  FIGURE: 'paragraph',
  TABLE: 'paragraph',
  H1: 'paragraph',
  H2: 'paragraph',
  H3: 'paragraph',
  H4: 'paragraph',
  H5: 'paragraph',
  H6: 'paragraph',
  LI: 'listItem',
  TR: 'tableRow',
  SECTION: 'section',
  ARTICLE: 'section',
  HR: 'section',
};

export function collectHints(ctx: CollectContext): DomHints {
  const out = emptyHints();
  const { crop, offset, seen } = ctx;
  const band = { top: crop.y, bottom: crop.y + crop.height };
  const docY = (vy: number) => vy - crop.y + offset;
  const docRect = (r: DOMRect | DOMRectReadOnly): Rect => ({
    x: r.left - crop.x,
    y: docY(r.top),
    width: r.width,
    height: r.height,
  });
  const inBand = (r: DOMRect | DOMRectReadOnly) =>
    r.bottom > band.top && r.top < band.bottom && r.width > 0 && r.height > 0;
  const fresh = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  const k = (v: number) => Math.round(v);

  // Visibility is checked once per element per frame.
  const visible = new Map<Element, boolean>();
  const isVisible = (el: Element) => {
    let v = visible.get(el);
    if (v === undefined) {
      // Computed `visibility` is checked directly as well: it is inherited, so it also
      // covers text whose ancestor was hidden.
      v =
        el.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          checkOpacity: true,
          checkVisibilityCSS: true,
        }) && getComputedStyle(el).visibility === 'visible';
      visible.set(el, v);
    }
    return v;
  };

  // Text: one rect per line fragment (CAPTURE §11).
  const walker = document.createTreeWalker(ctx.root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // Every node gets its number on the first walk (in DOM order), even outside the band.
    if (!ctx.order.has(n)) ctx.order.set(n, ctx.nextOrder++);
    const text = n.nodeValue ?? '';
    if (!text.trim()) continue;
    const parent = n.parentElement;
    if (!parent || !isVisible(parent)) continue;
    if (!inBand(parent.getBoundingClientRect())) continue;
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const fontSizePx = parseFloat(getComputedStyle(parent).fontSize) || 16;
    const total = rects.reduce((s, r) => s + r.width, 0);
    let used = 0;
    rects.forEach((r, i) => {
      const prev = rects[i - 1];
      // Between two lines of the same text node: a line-level cut position.
      if (prev && r.top >= prev.bottom - 1) {
        const y = docY((prev.bottom + r.top) / 2);
        if (fresh(`b:line:${k(y)}`)) out.blockEnds.push({ y, kind: 'line' });
      }
      // Distribute the node's text over its fragments by width; exact per-line text
      // would need a Range per character.
      const chars =
        i === rects.length - 1 ? text.length - used : Math.round((text.length * r.width) / total);
      const runText = text.slice(used, used + chars);
      used += chars;
      if (!inBand(r)) return;
      const d = docRect(r);
      if (fresh(`f:line:${k(d.y)}:${k(d.y + d.height)}`)) {
        out.forbidden.push({ y0: d.y - 1, y1: d.y + d.height + 1, kind: 'line' });
      }
      if (!ctx.skipTextRuns && runText.trim() && fresh(`t:${k(d.x)},${k(d.y)}:${runText}`)) {
        out.textRuns.push({ text: runText, rect: d, fontSizePx, order: ctx.order.get(n)! });
      }
    });
  }
  range.detach();

  for (const el of ctx.root.querySelectorAll(ATOMIC)) {
    if (el.parentElement?.closest('svg')) continue; // nested svg parts belong to the outer svg
    const r = el.getBoundingClientRect();
    if (!inBand(r) || !isVisible(el)) continue;
    const d = docRect(r);
    const kind = el.tagName === 'IMG' || el.tagName === 'PICTURE' ? 'image' : 'atomic';
    if (fresh(`f:${kind}:${k(d.y)}:${k(d.y + d.height)}`)) {
      out.forbidden.push({ y0: d.y, y1: d.y + d.height, kind });
    }
  }

  for (const el of ctx.root.querySelectorAll(OPAQUE)) {
    const r = el.getBoundingClientRect();
    if (!inBand(r) || !isVisible(el)) continue;
    // Same-origin iframes are opaque too: their DOM is not walked.
    const d = docRect(r);
    if (fresh(`o:${k(d.x)},${k(d.y)},${k(d.width)},${k(d.height)}`)) out.opaque.push(d);
  }

  for (const el of ctx.root.querySelectorAll(Object.keys(BLOCK_KIND).join(','))) {
    const r = el.getBoundingClientRect();
    if (!inBand(r) || !isVisible(el)) continue;
    const kind = BLOCK_KIND[el.tagName]!;
    const add = (b: Boundary) => fresh(`b:${b.kind}:${k(b.y)}`) && out.blockEnds.push(b);
    add({ y: docY(r.bottom), kind });
    if (/^H[1-3]$/.test(el.tagName)) {
      add({ y: docY(r.top), kind: 'section' });
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const level = Number(el.tagName[1]) as 1 | 2 | 3;
      if (text && fresh(`h:${level}:${k(docY(r.top))}:${text}`)) {
        out.headings.push({ level, text: text.slice(0, 200), y: docY(r.top) });
      }
    }
    if (/^H[1-6]$/.test(el.tagName)) {
      // Keep the heading with the first line of whatever follows it.
      const next = el.nextElementSibling;
      if (next) {
        const nr = next.getBoundingClientRect();
        const cs = getComputedStyle(next);
        const line = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.4;
        const y0 = docY(r.top);
        const y1 = docY(nr.top + Math.min(nr.height, line));
        if (y1 > y0 && fresh(`kwn:${k(y0)}:${k(y1)}`)) out.keepWithNext.push({ y0, y1 });
      }
    }
    if (el.tagName === 'TABLE') {
      const table = el as HTMLTableElement;
      const y0 = docY(r.top);
      if (fresh(`tab:${k(y0)}:${k(docY(r.bottom))}`)) {
        out.tables.push({
          y0,
          y1: docY(r.bottom),
          rowEnds: [...table.rows].map((row) => docY(row.getBoundingClientRect().bottom)),
          headerHeight: table.tHead?.getBoundingClientRect().height ?? 0,
        });
      }
    }
  }

  for (const a of ctx.root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!a.href || a.href.startsWith('javascript:')) continue;
    let targetY: number | undefined;
    const samePage =
      a.origin === location.origin &&
      a.pathname === location.pathname &&
      a.search === location.search;
    if (samePage && a.hash.length > 1) {
      const id = decodeURIComponent(a.hash.slice(1));
      const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
      if (target && ctx.root.contains(target)) targetY = docY(target.getBoundingClientRect().top);
    }
    for (const r of a.getClientRects()) {
      if (!inBand(r)) continue;
      const d = docRect(r);
      if (fresh(`a:${k(d.x)},${k(d.y)}:${a.href}`)) {
        out.links.push(
          targetY === undefined ? { href: a.href, rect: d } : { href: a.href, rect: d, targetY },
        );
      }
    }
  }
  return out;
}
