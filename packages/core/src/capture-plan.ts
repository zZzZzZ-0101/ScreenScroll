import type { Px } from './geometry.js';

export interface CaptureLimits {
  /** Hard cap on frames (default 300 screens). */
  maxScreens: number;
  /** Hard cap on captured height in CSS px (default 200,000). */
  maxHeight: Px;
}

export const DEFAULT_LIMITS: CaptureLimits = { maxScreens: 300, maxHeight: 200_000 };

export interface LoopState {
  /** Height of the crop rect (the part of each frame we keep), CSS px. */
  viewportHeight: Px;
  /** Current scrollable height of the target; may grow (infinite scroll). */
  scrollHeight: Px;
  /** Measured offset of the last frame taken, or null before the first frame. */
  lastOffset: Px | null;
  framesTaken: number;
  /** scrollHeight when capture started, to detect growth. */
  initialScrollHeight: Px;
}

export type StopReason = 'done' | 'max-screens' | 'max-height' | 'stuck';

export type NextStep =
  { kind: 'scroll'; y: Px } | { kind: 'stop'; reason: StopReason; warning: string | null };

/**
 * Decides where to scroll next (CAPTURE §5, §9). Steps are one full crop height, so frames
 * abut; the last step clamps to the bottom and overlaps, which the compositor handles.
 * Every stop other than reaching the end carries a warning: truncation is never silent (L11).
 */
export function nextStep(s: LoopState, limits: CaptureLimits = DEFAULT_LIMITS): NextStep {
  if (s.lastOffset === null) return { kind: 'scroll', y: 0 };

  const bottom = Math.max(0, s.scrollHeight - s.viewportHeight);
  const capturedTo = s.lastOffset + s.viewportHeight;
  if (s.lastOffset >= bottom - 1) {
    return { kind: 'stop', reason: 'done', warning: null };
  }
  const grew = s.scrollHeight > s.initialScrollHeight + 1;
  if (s.framesTaken >= limits.maxScreens) {
    return { kind: 'stop', reason: 'max-screens', warning: truncated(s.framesTaken, grew) };
  }
  if (capturedTo >= limits.maxHeight) {
    return { kind: 'stop', reason: 'max-height', warning: truncated(s.framesTaken, grew) };
  }
  return { kind: 'scroll', y: Math.min(s.lastOffset + s.viewportHeight, bottom) };
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
