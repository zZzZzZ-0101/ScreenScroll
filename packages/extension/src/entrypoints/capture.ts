import {
  DEFAULT_LIMITS,
  LAZY_SRCSET_ATTRS,
  LAZY_SRC_ATTRS,
  MutationLog,
  STUCK_WARNING,
  chooseScrollTarget,
  isPlaceholderSrc,
  isStuck,
  nextStep,
  regionFrame,
  type Annotation,
  type NextStep,
  type PillReserve,
  type Rect,
  type Region,
  type ScrollCandidate,
} from '@screenscroll/core';
import { collectHints, type CollectContext } from '@/content/hints-collector';
import {
  OVERLAY_WARNING,
  TAB_HIDDEN,
  type CaptureControl,
  type CaptureDone,
  type GrabFrame,
  type PageNotice,
  type GrabResult,
  type StartCapture,
} from '@/shared/messages';
import { pickArea, type AreaOutput } from '@/content/area-picker';
import { elementRegion, pickElement, pickLines, pickScrollArea } from '@/content/page-ui';
import { makePill, type Pill } from '@/content/pill';
import { documentTarget, elementTarget, isScroller, type Target } from '@/content/targets';
import { setLang, t as tr } from '@/shared/i18n';

// Injected on demand into the page (CAPTURE §2). All page changes go through `log` so they
// are undone on success, error, Esc and pagehide (CAPTURE §10).
export default defineUnlistedScript(() => {
  const w = window as unknown as { __spCaptureLoaded?: boolean };
  if (w.__spCaptureLoaded) return;
  w.__spCaptureLoaded = true;

  chrome.runtime.onMessage.addListener((msg: StartCapture | CaptureControl | PageNotice) => {
    if (msg.type === 'sp:start') {
      // The page-side hints speak the user's language (it can't read settings itself).
      if (msg.lang) setLang(msg.lang);
      void run(msg);
    }
    // From the toolbar panel: the same Stop here / Cancel as on the pill.
    if (msg.type === 'sp:control') control?.[msg.action]();
    // After a quick output (copy, PDF) finished elsewhere: say so where the user is.
    if (msg.type === 'sp:notice') makePill().notice(msg.text, 'done', 3000);
  });
});

const FREEZE_CSS = `*, *::before, *::after {
  animation-duration: 1ms !important; animation-iteration-count: 1 !important;
  transition-duration: 1ms !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

/** What to capture once the user has picked (or nothing needed picking). */
type Plan =
  | { kind: 'scroll'; target: Target | null; visibleOnly: boolean } // null = choose automatically
  | {
      kind: 'region';
      target: Target;
      region: Region;
      /** Area mode: how the user chose to finish, and the marks drawn before capturing. */
      output?: AreaOutput;
      annotations?: Annotation[];
    };

/** The picker step of selection, element and scroll-area modes (UI §2). Null = cancelled. */
async function plan(msg: StartCapture): Promise<Plan | null> {
  switch (msg.mode) {
    case 'full':
    case 'visible':
      if (msg.region) return { kind: 'region', target: documentTarget(), region: msg.region };
      return { kind: 'scroll', target: null, visibleOnly: msg.mode === 'visible' };
    case 'selection': {
      const sel = msg.region ? { target: documentTarget(), region: msg.region } : await pickArea();
      return sel && { kind: 'region', ...sel };
    }
    case 'lines': {
      const sel = msg.region ? { target: documentTarget(), region: msg.region } : await pickLines();
      return sel && { kind: 'region', ...sel };
    }
    case 'element': {
      const el = await pickElement();
      if (!el) return null;
      // An element that scrolls is captured whole, like a page (CAPTURE §14).
      if (isScroller(el)) return { kind: 'scroll', target: elementTarget(el), visibleOnly: false };
      return { kind: 'region', ...elementRegion(el) };
    }
    case 'pick-scroller': {
      const el = await pickScrollArea();
      return el && { kind: 'scroll', target: elementTarget(el), visibleOnly: false };
    }
  }
}

/** The running capture's Stop here / Cancel, for messages from the toolbar panel. */
let control: { stop: () => void; cancel: () => void } | null = null;

async function run(msg: StartCapture): Promise<void> {
  const log = new MutationLog();
  const warnings: string[] = [];
  let cancelled = false;
  let stopped = false;
  let picking = false;
  let status: CaptureDone['status'];
  let finishWith: Pick<CaptureDone, 'output' | 'annotations'> = {};
  let size = { width: 0, height: 0 };
  /** Why the capture had to end and its frames were thrown away (shown on the page). */
  let abandoned: string | null = null;
  const cancel = () => {
    cancelled = true;
    // A picker is waiting for the user: Esc is how it ends.
    if (picking) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  };
  const stop = () => {
    stopped = true;
    pill.set(tr('Stopping…'));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  const onHide = () => {
    cancelled = true;
    log.restore();
  };
  const pill = makePill({ onStop: stop, onCancel: cancel });
  control = { stop, cancel };
  let unguard = () => {};
  // Esc must reach this page even if the user last clicked into an embedded frame.
  const focused = document.activeElement;
  if (focused instanceof HTMLIFrameElement) {
    focused.blur();
    log.record(() => focused.focus());
  }

  try {
    addEventListener('keydown', onKey, true);
    if (msg.delayMs) {
      // UI §1 delayed capture: time to open a menu or hover a tooltip.
      for (let left = Math.ceil(msg.delayMs / 1000); left > 0 && !cancelled; left--) {
        pill.set(tr('Capturing in {n} s', { n: left }));
        await sleep(1000);
      }
      if (cancelled) throw new Cancelled();
    }
    // The pickers show their own hint (with Esc) while the user chooses.
    pill.hide();
    removeEventListener('keydown', onKey, true);
    if (msg.timing) timing = msg.timing;
    picking = true;
    let p = await plan(msg);
    picking = false;
    if (!p || cancelled) throw new Cancelled();
    if (p.kind === 'region') finishWith = { output: p.output, annotations: p.annotations };
    // A zero-size selection or a hidden element: say so rather than produce nothing.
    if (p.kind === 'region' && (p.region.x1 - p.region.x0 < 1 || p.region.y1 - p.region.y0 < 1))
      throw new Error('The selected area is empty, so nothing was captured.');
    pill.set(tr('Getting the page ready'));
    pill.show();
    addEventListener('keydown', onKey, true);
    addEventListener('pagehide', onHide);
    unguard = guardInput(pill);

    let target = p.target ?? pickTarget();
    // A dialog-style scroll lock (overflow hidden on html/body) leaves nothing to scroll.
    // Only unlock when no inner scroller was found, so app layouts keep their panel.
    if (
      p.kind === 'scroll' &&
      !p.target &&
      !target.el &&
      target.scrollHeight <= innerHeight + 2 &&
      unlockScroll(log)
    ) {
      target = pickTarget();
    }
    const startOffset = target.offset;
    const t = target;
    log.record(() => t.scrollTo(startOffset));
    // Settings → "Where I am now": a full-page capture from the current position to the end.
    if (msg.startAt === 'here' && p.kind === 'scroll' && !p.visibleOnly && startOffset > 0) {
      p = {
        kind: 'region',
        target,
        region: {
          x0: target.crop.x,
          x1: target.crop.x + target.crop.width,
          y0: startOffset,
          y1: target.scrollHeight,
        },
      };
    }
    warnings.push(...prepare(log, target, !!msg.hideOverlays));
    // Viewers that live in an embedded frame (some document previews) can't be scrolled from
    // here: say so instead of quietly returning one screen.
    if (p.kind === 'scroll' && !target.el && target.maxScroll <= 2) {
      const front = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (front instanceof HTMLIFrameElement) {
        const r = front.getBoundingClientRect();
        if (r.width * r.height > 0.3 * innerWidth * innerHeight)
          warnings.push(
            'The content is inside an embedded frame that ScreenScroll can’t scroll yet, so only the visible screen was captured. Try opening the frame’s content in its own tab.',
          );
      }
    }
    const iframes = unreadableIframes();
    if (iframes > 0) {
      warnings.push(
        `${iframes} embedded frame(s) from other sites were captured as pictures only; their text and links are not readable.`,
      );
    }
    eagerLoadImages(log);
    if (p.kind === 'region' || !p.visibleOnly) {
      const from = p.kind === 'region' ? p.region.y0 : 0;
      const to = p.kind === 'region' ? p.region.y1 : Infinity;
      const preload = await preloadPass(
        target,
        () => cancelled,
        Math.min(200, msg.limits?.maxScreens ?? DEFAULT_LIMITS.maxScreens),
        from,
        to,
      );
      if (preload) warnings.push(preload);
      target.scrollTo(from);
    }
    // One global wait so slow images requested by the preload pass can finish (CAPTURE §5).
    await waitForImages([...document.images], timing.pageImageWaitMs);
    await document.fonts.ready;

    const ctx: LoopContext = {
      msg,
      log,
      warnings,
      pill,
      cancelled: () => cancelled,
      stopped: () => stopped,
      size: { width: innerWidth, height: innerHeight },
      hints: {
        root: target.el ?? document.body,
        crop: target.crop,
        offset: 0,
        seen: new Set<string>(),
        skipTextRuns: false,
        order: new WeakMap<Node, number>(),
        nextOrder: 0,
      },
    };
    const result =
      p.kind === 'region'
        ? await captureRegion(ctx, target, p.region)
        : await captureScroll(ctx, target, p.visibleOnly);
    status = result.status;
    size = result.size;
  } catch (e) {
    if (e instanceof Abandoned) {
      status = 'cancelled';
      abandoned = e.message;
      warnings.push(e.message);
    } else if (e instanceof Cancelled) status = 'cancelled';
    else {
      status = 'error';
      warnings.push(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    unguard();
    control = null;
    // Whatever happened is said where the user is looking (never fail silently), and stays
    // long enough to read.
    if (status! === 'error') pill.notice(warnings.at(-1)!.replace(/^Capture failed: /, ''));
    else if (abandoned) pill.notice(abandoned);
    else if (status! === 'cancelled')
      pill.notice('Capture cancelled. Nothing was saved.', 'done', 3500);
    else pill.remove();
    const errors = log.restore();
    if (errors.length) warnings.push(`${errors.length} page change(s) could not be undone.`);
    removeEventListener('keydown', onKey, true);
    removeEventListener('pagehide', onHide);
  }

  const done: CaptureDone = {
    type: 'sp:done',
    sessionId: msg.sessionId,
    status,
    docWidth: size.width,
    docHeight: size.height,
    warnings,
    ...finishWith,
  };
  await chrome.runtime.sendMessage(done);
}

class Cancelled extends Error {}
/** The capture can't go on (the window was resized): it ends and nothing is kept. */
class Abandoned extends Error {}

/**
 * While capturing, scrolling, clicking or typing in the page would spoil the frames. Block
 * them, and answer each attempt by saying on the pill that the page is paused and how to
 * stop (an accidental start must never leave the user stuck). The pill's own buttons work.
 */
function guardInput(pill: Pill): () => void {
  const SCROLL_KEYS = new Set([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'PageUp',
    'PageDown',
    'Home',
    'End',
    ' ',
  ]);
  const block = (e: Event) => {
    if (e.target === pill.host) return;
    e.preventDefault();
    e.stopPropagation();
    pill.alert();
  };
  const onKey = (e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key) && e.target !== pill.host) block(e);
  };
  const types = [
    'wheel',
    'touchmove',
    'mousedown',
    'pointerdown',
    'click',
    'auxclick',
    'contextmenu',
  ];
  for (const t of types) addEventListener(t, block, { capture: true, passive: false });
  addEventListener('keydown', onKey, true);
  return () => {
    for (const t of types) removeEventListener(t, block, { capture: true });
    removeEventListener('keydown', onKey, true);
  };
}

interface LoopContext {
  msg: StartCapture;
  log: MutationLog;
  warnings: string[];
  pill: Pill;
  cancelled: () => boolean;
  /** "Stop here": end now and keep what was captured. */
  stopped: () => boolean;
  /** Window size at the start; frames from a different size can't be stitched. */
  size: { width: number; height: number };
  hints: CollectContext;
}

interface LoopResult {
  status: CaptureDone['status'];
  size: { width: number; height: number };
}

/**
 * Settle, collect hints, put the pill where this frame doesn't keep rows, and grab one frame
 * (CAPTURE §2 step 5). Waits while the tab is in the background, puts the scroll back if
 * something moved it, and gives up if the window changed size.
 */
async function grabFrame(
  ctx: LoopContext,
  target: Target,
  index: number,
  frame: {
    docY: number;
    crop: Rect;
    offset: number;
    pill: Extract<NextStep, { kind: 'scroll' }>['pill'];
  },
): Promise<void> {
  const { docY, crop, offset } = frame;
  const stillLoading = await settle();
  if (stillLoading > 0 && !ctx.warnings.includes(IMAGES_WARNING)) ctx.warnings.push(IMAGES_WARNING);
  // The pill hangs off <html>, outside the walk root, so it never appears in hints.
  ctx.hints.crop = crop;
  ctx.hints.offset = docY;
  const t0 = performance.now();
  const hints = collectHints(ctx.hints);
  const hintsMs = performance.now() - t0;
  if (hintsMs > 50 && !ctx.hints.skipTextRuns) {
    // CAPTURE §11 budget: keep line boxes, drop text runs for the rest of the capture.
    ctx.hints.skipTextRuns = true;
    ctx.warnings.push('Page text was too slow to read; the PDF may not be fully searchable.');
  }
  ctx.pill.set(frame.pill === 'top' ? tr('Finishing') : tr('Capturing · screen {n}', { n: index + 1 }));
  ctx.pill.canStop(index > 0);
  if (frame.pill === 'hidden') ctx.pill.hide();
  else ctx.pill.place(frame.pill);
  const grab: GrabFrame = {
    type: 'sp:grab',
    sessionId: ctx.msg.sessionId,
    index,
    docY,
    crop,
    viewportWidth: innerWidth,
    hints,
    hintsMs,
  };
  for (;;) {
    if (document.hidden) {
      // captureVisibleTab would picture whatever tab is in front instead.
      await whileHidden(ctx.cancelled);
      ctx.pill.alert(tr('Paused while this tab was in the background. Continuing.'));
    }
    if (ctx.cancelled()) throw new Cancelled();
    if (innerWidth !== ctx.size.width || innerHeight !== ctx.size.height)
      throw new Abandoned(
        'The window size or zoom changed during the capture, so it stopped and nothing was kept. Capture again.',
      );
    if (Math.abs(target.offset - offset) > 0.5) target.scrollTo(offset);
    await frames(2);
    if (document.hidden || Math.abs(target.offset - offset) > 0.5) continue;
    const res = (await chrome.runtime.sendMessage(grab)) as GrabResult;
    if (frame.pill === 'hidden') ctx.pill.show();
    if (res.ok) return;
    if (res.error !== TAB_HIDDEN) throw new Error(res.error);
  }
}

const IMAGES_WARNING = 'Some images had not finished loading when captured and may appear blank.';

/** Waits until the tab is in front again (or the capture is cancelled from the panel). */
async function whileHidden(cancelled: () => boolean): Promise<void> {
  while (document.hidden && !cancelled()) await sleep(250);
}

/** Rows of the target's box the pill covers at the bottom and at the top of the screen. */
function pillReserve(pill: Pill, box: Rect, x0: number, x1: number): PillReserve {
  const covers = (s: { x0: number; x1: number }) => s.x0 < x1 && s.x1 > x0;
  const b = pill.strip('bottom');
  const t = pill.strip('top');
  const clamp = (v: number) => Math.max(0, Math.min(box.height, Math.ceil(v)));
  return {
    bottom: covers(b) ? clamp(box.y + box.height - (innerHeight - b.height)) : 0,
    top: covers(t) ? clamp(t.height - box.y) : 0,
  };
}

const stoppedWarning = (frames: number) =>
  `You stopped the capture after ${frames} screen${frames === 1 ? '' : 's'}; the rest was not captured.`;

/** Full page or visible area of a scroll target (CAPTURE §2, §9). */
async function captureScroll(
  ctx: LoopContext,
  target: Target,
  visibleOnly: boolean,
): Promise<LoopResult> {
  const initialScrollHeight = target.scrollHeight;
  const box = target.crop;
  const reserve = pillReserve(ctx.pill, box, box.x, box.x + box.width);
  // The visible area is a one-screen page that doesn't scroll.
  const start = visibleOnly ? target.offset : 0;
  let covered: number | null = null;
  let lastOffset: number | null = null;
  for (let index = 0; ; index++) {
    if (ctx.cancelled()) throw new Cancelled();
    if (ctx.stopped()) {
      if (index === 0) throw new Cancelled();
      ctx.warnings.push(stoppedWarning(index));
      break;
    }
    const end = visibleOnly ? start + box.height : target.scrollHeight;
    const step = nextStep(
      {
        viewportHeight: box.height,
        scrollHeight: end,
        maxScroll: visibleOnly ? start : target.maxScroll,
        start,
        coveredTo: covered,
        framesTaken: index,
        initialScrollHeight: visibleOnly ? end : initialScrollHeight,
      },
      ctx.msg.limits,
      reserve,
    );
    if (step.kind === 'stop') {
      if (step.warning) ctx.warnings.push(step.warning);
      break;
    }
    if (!visibleOnly) target.scrollTo(step.y);
    // Before settling: the freeze stylesheet gives every property a 1 ms transition, so
    // `visibility: hidden` only takes effect a frame later.
    if (index === 1 && !visibleOnly) hideFixedTop(ctx.log);
    const measured = target.offset;
    if (!visibleOnly && isStuck(step.y, measured, lastOffset)) {
      ctx.warnings.push(STUCK_WARNING);
      break;
    }
    const { top, bottom } = step.keep;
    await grabFrame(ctx, target, index, {
      docY: measured + top,
      crop: { x: box.x, y: box.y + top, width: box.width, height: bottom - top },
      offset: measured,
      pill: step.pill,
    });
    covered = Math.max(covered ?? 0, measured + bottom);
    lastOffset = measured;
  }
  return { status: 'complete', size: { width: box.width, height: target.scrollHeight } };
}

/** Selection and element modes: only the region, stitched across as many frames as needed. */
async function captureRegion(
  ctx: LoopContext,
  target: Target,
  region: Region,
): Promise<LoopResult> {
  const size = { width: region.x1 - region.x0, height: region.y1 - region.y0 };
  const box = target.crop;
  const reserve = pillReserve(ctx.pill, box, region.x0, region.x1);
  // A fixed header would cover the region's top in every frame unless the region starts at
  // the very top of the page, where the header is part of what was selected.
  if (region.y0 > 0) hideFixedTop(ctx.log);
  let covered: number | null = null;
  for (let index = 0; ; index++) {
    if (ctx.cancelled()) throw new Cancelled();
    if (ctx.stopped()) {
      if (index === 0) throw new Cancelled();
      ctx.warnings.push(stoppedWarning(index));
      break;
    }
    const step = nextStep(
      {
        viewportHeight: box.height,
        scrollHeight: region.y1,
        maxScroll: target.maxScroll,
        start: region.y0,
        coveredTo: covered,
        framesTaken: index,
        initialScrollHeight: region.y1,
      },
      ctx.msg.limits,
      reserve,
    );
    if (step.kind === 'stop') {
      if (step.reason !== 'done')
        ctx.warnings.push(
          `The selection is longer than the capture limit; captured the first ${index} screens.`,
        );
      break;
    }
    target.scrollTo(step.y);
    await frames(2);
    const offset = target.offset;
    const { top, bottom } = step.keep;
    const view = { ...box, y: box.y + top, height: bottom - top };
    const f = regionFrame(region, view, offset + top, covered ?? region.y0);
    if (!f) {
      ctx.warnings.push(STUCK_WARNING);
      break;
    }
    await grabFrame(ctx, target, index, { docY: f.docY, crop: f.crop, offset, pill: step.pill });
    covered = f.coveredTo;
  }
  return { status: 'complete', size };
}

/** CAPTURE §3: the document, or the largest inner scroller when that is what scrolls. */
function pickTarget(): Target {
  const se = document.scrollingElement ?? document.documentElement;
  const candidates: ScrollCandidate[] = [];
  const els: Element[] = [];
  // Whatever is in front at the middle of the screen: a viewer over a file list, an opened
  // mail over the inbox (CAPTURE §3).
  const front = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  for (const el of document.querySelectorAll('body *')) {
    if (!isScroller(el)) continue;
    const r = el.getBoundingClientRect();
    candidates.push({
      atCenter: !!front && el.contains(front),
      id: els.length,
      rect: {
        x: r.left + el.clientLeft,
        y: r.top + el.clientTop,
        width: el.clientWidth,
        height: el.clientHeight,
      },
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    els.push(el);
  }
  const choice = chooseScrollTarget({
    viewport: { width: innerWidth, height: innerHeight },
    docScrollHeight: se.scrollHeight,
    candidates,
  });
  return choice.kind === 'element' ? elementTarget(els[choice.id]!) : documentTarget();
}

/** CAPTURE §4, §6: freeze motion, flatten sticky, drop bottom bars and fixed backgrounds. */
/**
 * Returns warnings, e.g. for overlays it leaves in place; with `hideOverlays` (the overlay
 * killer) it hides them instead, and says how many.
 */
function prepare(log: MutationLog, target: Target, hideOverlays = false): string[] {
  let overlays = 0;
  const hide = (el: HTMLElement) => {
    overlays++;
    // display, not visibility: a modal <dialog>'s ::backdrop only goes with the dialog box.
    if (hideOverlays) log.setStyle(el, 'display', 'none');
  };
  const style = document.createElement('style');
  style.textContent = FREEZE_CSS;
  document.documentElement.append(style);
  log.record(() => style.remove());
  // The stylesheet only affects animations that start from now on; jump the running ones
  // (fade-ins, already-started transitions) to their end state. Infinite CSS animations are
  // finite now (iteration count 1), so finish() works on them; anything else is skipped.
  for (const a of document.getAnimations()) {
    try {
      a.finish();
    } catch {
      // Infinite script-driven animations can't be finished.
    }
  }

  for (const v of document.querySelectorAll('video')) {
    if (!v.paused) {
      v.pause();
      log.record(() => void v.play().catch(() => undefined));
    }
  }

  const vpArea = innerWidth * innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const cs = getComputedStyle(el);
    if (cs.backgroundAttachment === 'fixed') log.setStyle(el, 'background-attachment', 'scroll');
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (target.el && (el === target.el || el.contains(target.el))) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > 0.8 * vpArea) {
      if (cs.position === 'fixed' && isBackdrop(el, cs)) hide(el);
      continue;
    }
    if (cs.position === 'sticky') {
      log.setStyle(el, 'position', 'relative');
      for (const side of ['top', 'right', 'bottom', 'left']) log.setStyle(el, side, 'auto');
    } else if (isMidViewportOverlay(r, cs)) {
      // Modals and pop-ups are content the user may want; leave them, but say so (CAPTURE §4).
      hide(el);
    } else if (r.top >= innerHeight / 2) {
      // Bottom-anchored bars (cookie notices, chat bubbles) are hidden in every frame.
      log.setStyle(el, 'visibility', 'hidden');
    } else {
      el.dataset.spFixedTop = '1';
      log.record(() => delete el.dataset.spFixedTop);
    }
  }
  if (!overlays) return [];
  return hideOverlays
    ? [`${overlays} pop-up ${overlays === 1 ? 'layer was' : 'layers were'} hidden for this capture.`]
    : [OVERLAY_WARNING];
}

const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

/**
 * A layer over the whole viewport that belongs to a pop-up: it holds a dialog, or it is a
 * see-through dimming sheet (no text or media of its own) lying on top of the page at both
 * sides. An app's own full-screen shell (a document viewer) has content, so it is neither.
 */
function isBackdrop(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
  if (el.matches(DIALOG) || el.querySelector(DIALOG)) return true;
  if (el.innerText.trim() || el.querySelector('img, video, canvas, iframe, svg')) return false;
  const alpha = Number(/rgba?\([^)]*[,/]\s*([\d.]+)\s*\)/.exec(cs.backgroundColor)?.[1] ?? 1);
  if (!(Number(cs.opacity) < 1 || (alpha > 0 && alpha < 0.95))) return false;
  const on = (x: number) => {
    const hit = document.elementFromPoint(x, innerHeight / 2);
    return !!hit && (hit === el || el.contains(hit));
  };
  return on(0.03 * innerWidth) && on(0.97 * innerWidth);
}

/** A visible fixed box floating in the middle band of the viewport, not anchored to an edge. */
function isMidViewportOverlay(r: DOMRect, cs: CSSStyleDeclaration): boolean {
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
  return r.top > 0.1 * innerHeight && r.bottom < 0.9 * innerHeight && r.height > 0.15 * innerHeight;
}

/**
 * CAPTURE §5: lazy images load eagerly; `data-src` style URLs are copied in only when the
 * current `src` is empty or a placeholder.
 */
function eagerLoadImages(log: MutationLog): void {
  const setAttr = (el: Element, name: string, value: string) => {
    const old = el.getAttribute(name);
    log.record(() => (old === null ? el.removeAttribute(name) : el.setAttribute(name, old)));
    el.setAttribute(name, value);
  };
  for (const img of document.querySelectorAll('img')) {
    if (img.loading === 'lazy') setAttr(img, 'loading', 'eager');
    if (isPlaceholderSrc(img.getAttribute('src'))) {
      const real = LAZY_SRC_ATTRS.map((a) => img.getAttribute(a)).find((v) => v);
      if (real) setAttr(img, 'src', real);
    }
  }
  for (const el of document.querySelectorAll('img, picture > source')) {
    if (el.getAttribute('srcset')) continue;
    const real = LAZY_SRCSET_ATTRS.map((a) => el.getAttribute(a)).find((v) => v);
    if (real) setAttr(el, 'srcset', real);
  }
}

/**
 * CAPTURE §5 preload pass: scroll through quickly so scroll-triggered loaders fire.
 * Stops at `maxScreens` (no point loading what capture won't reach; capture warns about
 * that itself) or after 60 s, which returns a warning.
 */
async function preloadPass(
  target: Target,
  cancelled: () => boolean,
  maxScreens: number,
  from = 0,
  to = Infinity,
): Promise<string | null> {
  const started = performance.now();
  const step = Math.max(1, Math.floor(target.crop.height * 0.9));
  for (let y = from, screens = 0; ; y += step, screens++) {
    if (cancelled()) return null;
    if (y >= target.scrollHeight - target.crop.height || y >= to) return null;
    if (screens >= maxScreens) return null;
    if (performance.now() - started > 60_000) {
      return 'Preloading stopped after 60 s; images further down may be missing.';
    }
    target.scrollTo(y);
    await sleep(120);
  }
}

/** CAPTURE §13: cross-origin iframes are captured as pixels only; count visible ones to warn. */
function unreadableIframes(): number {
  let n = 0;
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // Cross-origin frames give null (or throw in some browsers).
    let readable: boolean;
    try {
      readable = !!f.contentDocument;
    } catch {
      readable = false;
    }
    if (!readable) n++;
  }
  return n;
}

/** Sets `overflow: visible` on html/body when either hides vertical overflow. */
function unlockScroll(log: MutationLog): boolean {
  let changed = false;
  for (const el of [document.documentElement, document.body]) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'hidden' || oy === 'clip') {
      log.setStyle(el, 'overflow', 'visible');
      changed = true;
    }
  }
  return changed;
}

/** Top-anchored fixed headers appear in frame 1 only (CAPTURE §4). */
function hideFixedTop(log: MutationLog): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-sp-fixed-top]')) {
    log.setStyle(el, 'visibility', 'hidden');
  }
}

/**
 * CAPTURE §7: two frames, visible images loaded and decoded (1.5 s cap), then a short dwell.
 * Returns how many visible images were still incomplete, so the caller can warn.
 */
/** Settings → Capture speed (set when a capture starts). */
let timing = { settleMs: 150, frameImageWaitMs: 1500, pageImageWaitMs: 5000 };

async function settle(): Promise<number> {
  await frames(2);
  const visible = [...document.images].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  });
  const pending = await waitForImages(visible, timing.frameImageWaitMs);
  await sleep(timing.settleMs);
  return pending;
}

/** Waits until the images are loaded and decoded or the timeout passes; returns how many are not. */
async function waitForImages(images: HTMLImageElement[], timeoutMs: number): Promise<number> {
  const isPending = (img: HTMLImageElement) => !!img.currentSrc && !img.complete;
  await Promise.race([
    Promise.all(images.map((img) => img.decode().catch(() => undefined))),
    sleep(timeoutMs),
  ]);
  return images.filter(isPending).length;
}

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = (left: number) => (left ? requestAnimationFrame(() => tick(left - 1)) : resolve());
    tick(n);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
