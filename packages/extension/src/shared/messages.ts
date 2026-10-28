import type { CaptureLimits, DomHints, Rect, Region } from '@screenscroll/core';

/** CAPTURE §14. Selection, element and scroll-area modes start with an in-page picker. */
export type CaptureMode = 'full' | 'visible' | 'selection' | 'lines' | 'element' | 'pick-scroller';

/** Background → content script. */
export interface StartCapture {
  type: 'sp:start';
  sessionId: string;
  mode: CaptureMode;
  /** Defaults to 300 screens / 200,000 px; tests pass lower caps. */
  limits?: CaptureLimits;
  /** Delayed capture (UI §1): count down this long before capturing. */
  delayMs?: number;
  /** A region of the document to capture without the picker (tests, scripted use). */
  region?: Region;
}

/** Content script → background: grab the visible tab for this frame. */
export interface GrabFrame {
  type: 'sp:grab';
  sessionId: string;
  index: number;
  /** Measured offset of the crop top in the scroll target, CSS px. */
  docY: number;
  /** Crop rect in viewport CSS px. */
  crop: Rect;
  /** `innerWidth`, to derive the real DPR from the image width. */
  viewportWidth: number;
  /** DOM hints new in this frame (region coordinates). */
  hints: DomHints;
  /** Time spent collecting them, for the 50 ms budget. */
  hintsMs: number;
}

/** Content script → background: capture finished (or failed / was cancelled). */
export interface CaptureDone {
  type: 'sp:done';
  sessionId: string;
  status: 'complete' | 'cancelled' | 'error';
  docWidth: number;
  docHeight: number;
  warnings: string[];
}

export type ToBackground = GrabFrame | CaptureDone;
export type GrabResult = { ok: true } | { ok: false; error: string };
