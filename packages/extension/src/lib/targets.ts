import { intersect, type Rect } from '@scrollpress/core';

/** Something that scrolls vertically: the document or an inner element (CAPTURE §3). */
export interface Target {
  el: Element | null; // null = the document
  /** Visible box in viewport CSS px (excluding borders and scrollbar). */
  crop: Rect;
  readonly offset: number;
  scrollTo(y: number): void;
  readonly scrollHeight: number;
  readonly maxScroll: number;
}

export function isScroller(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 2) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

/** The closest scrolling ancestor (or the element itself), or null for the document. */
export function nearestScroller(el: Element | null): Element | null {
  for (
    let e = el;
    e && e !== document.body && e !== document.documentElement;
    e = e.parentElement
  ) {
    if (isScroller(e)) return e;
  }
  return null;
}

export function documentTarget(): Target {
  const se = document.scrollingElement ?? document.documentElement;
  return {
    el: null,
    crop: { x: 0, y: 0, width: document.documentElement.clientWidth, height: innerHeight },
    get offset() {
      return se.scrollTop;
    },
    scrollTo: (y) => void (se.scrollTop = y),
    get scrollHeight() {
      return se.scrollHeight;
    },
    get maxScroll() {
      return se.scrollHeight - innerHeight;
    },
  };
}

export function elementTarget(el: Element): Target {
  const r = el.getBoundingClientRect();
  // clientLeft/Top skip borders; clientWidth excludes the scrollbar.
  const box = {
    x: r.left + el.clientLeft,
    y: r.top + el.clientTop,
    width: el.clientWidth,
    height: el.clientHeight,
  };
  return {
    el,
    crop: intersect(box, { x: 0, y: 0, width: innerWidth, height: innerHeight }),
    get offset() {
      return el.scrollTop;
    },
    scrollTo: (y) => void (el.scrollTop = y),
    get scrollHeight() {
      return el.scrollHeight;
    },
    get maxScroll() {
      return el.scrollHeight - el.clientHeight;
    },
  };
}

export function targetFor(el: Element | null): Target {
  return el ? elementTarget(el) : documentTarget();
}

/** Content y of a viewport y, in the target's coordinates. */
export function contentY(t: Target, viewportY: number): number {
  return viewportY - t.crop.y + t.offset;
}
