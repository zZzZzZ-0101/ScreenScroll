import { area, intersect, type Rect } from './geometry.js';

/** What the content script measures about the document and each overflowing element. */
export interface ScrollCandidate {
  id: number;
  /** Client rect of the scroller's visible box (viewport coordinates). */
  rect: Rect;
  scrollHeight: number;
  clientHeight: number;
  /**
   * The scroller is what the user sees at the middle of the viewport (it contains the
   * topmost element there). Overlays such as a document viewer over a file list, or an
   * opened mail over the inbox, are in front even when something larger is behind them.
   */
  atCenter?: boolean;
}

export interface ScrollTargetInput {
  viewport: { width: number; height: number };
  /** `document.scrollingElement.scrollHeight`. */
  docScrollHeight: number;
  candidates: readonly ScrollCandidate[];
}

export type ScrollTarget = { kind: 'document' } | { kind: 'element'; id: number; crop: Rect };

const OVERFLOW_SLACK = 2;

/**
 * CAPTURE §3: scroll the document when it overflows; otherwise the inner scroller in front at
 * the viewport centre (≥ 25% of the viewport), else the one with the largest visible area
 * covering ≥ 30%. A large inner scroller (≥ 50%) wins
 * over a document that overflows by less than one viewport (app layouts like Gmail).
 */
export function chooseScrollTarget(input: ScrollTargetInput): ScrollTarget {
  const vp: Rect = { x: 0, y: 0, width: input.viewport.width, height: input.viewport.height };
  const vpArea = area(vp);
  let best: { c: ScrollCandidate; visible: Rect; share: number } | null = null;
  for (const c of input.candidates) {
    if (c.scrollHeight <= c.clientHeight + OVERFLOW_SLACK) continue;
    const visible = intersect(c.rect, vp);
    const share = area(visible) / vpArea;
    // What is in front at the centre wins over anything behind it; otherwise the largest.
    // Ties go to the earlier candidate so the choice is deterministic.
    const front = (x: ScrollCandidate | undefined) => (x?.atCenter && share >= 0.25 ? 1 : 0);
    if (!best || front(c) > front(best.c) || (front(c) === front(best.c) && share > best.share))
      best = { c, visible, share };
  }

  const docOverflow = input.docScrollHeight - input.viewport.height;
  const docScrolls = docOverflow > OVERFLOW_SLACK;
  const inner =
    best && (best.share >= 0.3 || (best.c.atCenter && best.share >= 0.25)) ? best : null;

  if (inner && (!docScrolls || (inner.share >= 0.5 && docOverflow < input.viewport.height))) {
    return { kind: 'element', id: inner.c.id, crop: inner.visible };
  }
  return { kind: 'document' };
}
