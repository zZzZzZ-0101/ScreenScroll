import type { Annotation, CaptureLimits, DomHints, Rect, Region } from '@screenscroll/core';

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
  /** Settings → Capture: start at the top, or where the user is now. */
  startAt?: 'top' | 'here';
  /** Settings → Capture speed: how long to let each screen settle. */
  timing?: { settleMs: number; frameImageWaitMs: number; pageImageWaitMs: number };
  /** Overlay killer: hide pop-ups, their backdrops and dialogs for this capture. */
  hideOverlays?: boolean;
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
  /** Area mode: what to do with the capture (default: the "After a capture" setting). */
  output?: 'studio' | 'pdf' | 'copy';
  /** Area mode: marks drawn before capturing, in capture coordinates. */
  annotations?: Annotation[];
}

/** Studio → background → page: a short message on the captured page (e.g. "Copied"). */
export interface PageNotice {
  type: 'sp:notice';
  text: string;
  /** The tab to show it in (Studio → background only). */
  tabId?: number;
}

/** Background/panel → content script: the pill's two buttons, from the toolbar panel. */
export interface CaptureControl {
  type: 'sp:control';
  action: 'stop' | 'cancel';
}

/** Grab refused because the capturing tab is not in front; the page waits and retries. */
export const TAB_HIDDEN = 'sp:tab-hidden';

/** Studio → background: capture the same tab again, with pop-ups hidden. */
export interface Recapture {
  type: 'sp:recapture';
  sessionId: string;
}

/** The warning that offers the overlay killer (CAPTURE §4). */
export const OVERLAY_WARNING =
  'A pop-up or overlay was covering the page and appears in the capture. Hide pop-ups and capture again to remove it.';

export type ToBackground = GrabFrame | CaptureDone;
export type GrabResult = { ok: true } | { ok: false; error: string };
