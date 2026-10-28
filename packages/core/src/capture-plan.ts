import type { Px } from './geometry.js';

export interface CaptureLimits {
  /** Hard cap on frames (default 300 screens). */
  maxScreens: number;
  /** Hard cap on captured height in CSS px (default 200,000). */
  maxHeight: Px;
}

export const DEFAULT_LIMITS: CaptureLimits = { maxScreens: 300, maxHeight: 200_000 };

/**
 * Rows of the scroll target's visible box that the progress pill covers: `bottom` while it
 * sits at the bottom of the screen, `top` when it moves up for the last frame. 0 when the
 * pill doesn't overlap what is captured.
 */
export interface PillReserve {
  top: Px;
  bottom: Px;
}

export const NO_RESERVE: PillReserve = { top: 0, bottom: 0 };

export interface LoopState {
  /** Height of the scroll target's visible box, CSS px. */
  viewportHeight: Px;
  /** Where the content to capture ends; may grow (infinite scroll). */
  scrollHeight: Px;
  /** Largest scroll offset; defaults to scrollHeight − viewportHeight. */
  maxScroll?: Px;
  /** Where the content to capture starts (default 0). */
  start?: Px;
  /** Content y captured so far, or null before the first frame. */
  coveredTo: Px | null;
  framesTaken: number;
  /** scrollHeight when capture started, to detect growth. */
  initialScrollHeight: Px;
}

export type StopReason = 'done' | 'max-screens' | 'max-height' | 'stuck';

/**
 * Where to scroll, where the pill goes, and which rows of the visible box (from its top) the
 * frame keeps. `hidden` means the box is too small to share with the pill: it is hidden for
 * that grab instead.
 */
export type NextStep =
  | {
      kind: 'scroll';
      y: Px;
      pill: 'bottom' | 'top' | 'hidden';
      keep: { top: Px; bottom: Px };
    }
  | { kind: 'stop'; reason: StopReason; warning: string | null };

/**
 * Decides the next frame (CAPTURE §5, §9). The progress pill stays on screen the whole time
 * (UI §2: the user must always see how to stop), so frames keep only the rows the pill does
 * not cover: with the pill at the bottom, each frame keeps the rows above it and the next
 * frame starts there. The rows under the pill at the very end of the content can't be
 * scrolled up any further, so the pill moves to the top for one last frame, taken where the
 * rows it now covers were already captured (one extra frame is added when they weren't).
 * Every stop other than reaching the end carries a warning: truncation is never silent (L11).
 */
export function nextStep(
  s: LoopState,
  limits: CaptureLimits = DEFAULT_LIMITS,
  reserve: PillReserve = NO_RESERVE,
): NextStep {
  const view = s.viewportHeight;
  const start = s.start ?? 0;
  const maxScroll = Math.max(0, s.maxScroll ?? s.scrollHeight - view);
  const c = s.coveredTo ?? start;
  if (s.coveredTo !== null && c >= s.scrollHeight - 0.5) {
    return { kind: 'stop', reason: 'done', warning: null };
  }
  const grew = s.scrollHeight > s.initialScrollHeight + 1;
  if (s.framesTaken >= limits.maxScreens) {
    return { kind: 'stop', reason: 'max-screens', warning: truncated(s.framesTaken, grew) };
  }
  if (c - start >= limits.maxHeight) {
    return { kind: 'stop', reason: 'max-height', warning: truncated(s.framesTaken, grew) };
  }

  // A box too small to share: hide the pill for each grab rather than take slivers.
  const shared = view - reserve.top - reserve.bottom >= 0.25 * view;
  const r = shared ? reserve : NO_RESERVE;
  const usable = view - r.bottom;
  const below = { top: 0, bottom: usable };
  const pill = !shared && (reserve.top || reserve.bottom) ? 'hidden' : 'bottom';

  if (c <= maxScroll) return { kind: 'scroll', y: Math.max(0, c), pill, keep: below };
  // The rest is on the last screen.
  if (maxScroll + usable >= s.scrollHeight - 0.5 || r.bottom === 0) {
    return { kind: 'scroll', y: maxScroll, pill, keep: below };
  }
  if (c >= maxScroll + r.top) {
    return { kind: 'scroll', y: maxScroll, pill: 'top', keep: { top: r.top, bottom: view } };
  }
  // Capture down to where the pill will sit at the top first.
  return { kind: 'scroll', y: Math.max(0, maxScroll + r.top - usable), pill, keep: below };
}

/**
 * The page refused to move (virtual scrollers that ignore scrollTo, scroll locks we could
 * not undo). Call with the requested and measured offsets after each scroll.
 */
export function isStuck(requested: Px, measured: Px, previous: Px | null): boolean {
  return previous !== null && requested > previous + 1 && measured <= previous + 1;
}

export const STUCK_WARNING =
  'The page stopped scrolling before the end. The capture may be incomplete.';

function truncated(frames: number, grew: boolean): string {
  return grew
    ? `Page kept loading more content; captured the first ${frames} screens.`
    : `Page is longer than the capture limit; captured the first ${frames} screens.`;
}
