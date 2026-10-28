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
  regionScroll,
  type Rect,
  type Region,
  type ScrollCandidate,
} from '@scrollpress/core';
import { collectHints, type CollectContext } from '@/lib/hints-collector';
import type { CaptureDone, GrabFrame, GrabResult, StartCapture } from '@/lib/messages';
import { elementRegion, pickElement, pickScrollArea, selectRegion } from '@/lib/page-ui';
import { documentTarget, elementTarget, isScroller, type Target } from '@/lib/targets';

// Injected on demand into the page (CAPTURE §2). All page changes go through `log` so they
// are undone on success, error, Esc and pagehide (CAPTURE §10).
export default defineUnlistedScript(() => {
  const w = window as unknown as { __spCaptureLoaded?: boolean };
  if (w.__spCaptureLoaded) return;
  w.__spCaptureLoaded = true;

  chrome.runtime.onMessage.addListener((msg: StartCapture) => {
    if (msg.type === 'sp:start') void run(msg);
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
  | { kind: 'region'; target: Target; region: Region };

/** The picker step of selection, element and scroll-area modes (UI §2). Null = cancelled. */
async function plan(msg: StartCapture): Promise<Plan | null> {
  switch (msg.mode) {
    case 'full':
    case 'visible':
      if (msg.region) return { kind: 'region', target: documentTarget(), region: msg.region };
      return { kind: 'scroll', target: null, visibleOnly: msg.mode === 'visible' };
    case 'selection': {
      const sel = msg.region
        ? { target: documentTarget(), region: msg.region }
        : await selectRegion();
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

async function run(msg: StartCapture): Promise<void> {
  const log = new MutationLog();
  const warnings: string[] = [];
  let cancelled = false;
  let status: CaptureDone['status'];
  let size = { width: 0, height: 0 };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancelled = true;
  };
  const onHide = () => {
    cancelled = true;
    log.restore();
  };
  const pill = makePill();

  try {
    if (msg.delayMs) {
      // UI §1 delayed capture: time to open a menu or hover a tooltip.
      addEventListener('keydown', onKey, true);
      for (let left = Math.ceil(msg.delayMs / 1000); left > 0 && !cancelled; left--) {
        pill.set(`Capturing in ${left} s · Esc to cancel`);
        await sleep(1000);
      }
      removeEventListener('keydown', onKey, true);
      if (cancelled) throw new Cancelled();
    }
    pill.hide();
    const p = await plan(msg);
    if (!p) throw new Cancelled();
    // A zero-size selection or a hidden element: say so rather than produce nothing.
    if (p.kind === 'region' && (p.region.x1 - p.region.x0 < 1 || p.region.y1 - p.region.y0 < 1))
      throw new Error('The selected area is empty, so nothing was captured.');
    pill.show();
    addEventListener('keydown', onKey, true);
    addEventListener('pagehide', onHide);

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
    warnings.push(...prepare(log, target));
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
    await waitForImages([...document.images], 5000);
    await document.fonts.ready;

    const ctx: LoopContext = {
      msg,
      log,
      warnings,
      pill,
      cancelled: () => cancelled,
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
    if (e instanceof Cancelled) status = 'cancelled';
    else {
      status = 'error';
      warnings.push(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    // A failure must be visible where the user is looking (never fail silently).
    if (status! === 'error') pill.notice(warnings.at(-1)!.replace(/^Capture failed: /, ''));
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
  };
  await chrome.runtime.sendMessage(done);
}

class Cancelled extends Error {}

interface LoopContext {
  msg: StartCapture;
  log: MutationLog;
  warnings: string[];
  pill: ReturnType<typeof makePill>;
  cancelled: () => boolean;
  hints: CollectContext;
}

interface LoopResult {
  status: CaptureDone['status'];
  size: { width: number; height: number };
}

/** Settle, collect hints, hide the pill and grab one frame (CAPTURE §2 step 5). */
async function grabFrame(ctx: LoopContext, index: number, docY: number, crop: Rect): Promise<void> {
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
  ctx.pill.set(`Capturing ${index + 1} · Esc to cancel`);
  ctx.pill.hide();
  await frames(2);
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
  const res = (await chrome.runtime.sendMessage(grab)) as GrabResult;
  ctx.pill.show();
  if (!res.ok) throw new Error(res.error);
}

const IMAGES_WARNING = 'Some images had not finished loading when captured and may appear blank.';

/** Full page or visible area of a scroll target (CAPTURE §2, §9). */
async function captureScroll(
  ctx: LoopContext,
  target: Target,
  visibleOnly: boolean,
): Promise<LoopResult> {
  const initialScrollHeight = target.scrollHeight;
  let lastOffset: number | null = null;
  for (let index = 0; ; index++) {
    if (ctx.cancelled())
      return {
        status: 'cancelled',
        size: { width: target.crop.width, height: target.scrollHeight },
      };
    const step =
      visibleOnly && lastOffset !== null
        ? ({ kind: 'stop', reason: 'done', warning: null } as const)
        : nextStep(
            {
              viewportHeight: target.crop.height,
              scrollHeight: target.scrollHeight,
              lastOffset,
              framesTaken: index,
              initialScrollHeight,
            },
            ctx.msg.limits,
          );
    if (step.kind === 'stop') {
      if (step.warning) ctx.warnings.push(step.warning);
      break;
    }
    if (!visibleOnly) target.scrollTo(step.y);
    // Before settling: the freeze stylesheet gives every property a 1 ms transition, so
    // `visibility: hidden` only takes effect a frame later.
    if (index === 1) hideFixedTop(ctx.log);
    const measured = target.offset;
    if (!visibleOnly && isStuck(step.y, measured, lastOffset)) {
      ctx.warnings.push(STUCK_WARNING);
      break;
    }
    await grabFrame(ctx, index, measured, target.crop);
    lastOffset = measured;
  }
  return { status: 'complete', size: { width: target.crop.width, height: target.scrollHeight } };
}

/** Selection and element modes: only the region, stitched across as many frames as needed. */
async function captureRegion(
  ctx: LoopContext,
  target: Target,
  region: Region,
): Promise<LoopResult> {
  const size = { width: region.x1 - region.x0, height: region.y1 - region.y0 };
  // A fixed header would cover the region's top in every frame unless the region starts at
  // the very top of the page, where the header is part of what was selected.
  if (region.y0 > 0) hideFixedTop(ctx.log);
  let covered = region.y0;
  const maxFrames = ctx.msg.limits?.maxScreens ?? DEFAULT_LIMITS.maxScreens;
  for (let index = 0; covered < region.y1 - 0.5; index++) {
    if (ctx.cancelled()) return { status: 'cancelled', size };
    if (index >= maxFrames) {
      ctx.warnings.push(
        `The selection is longer than the capture limit; captured the first ${index} screens.`,
      );
      break;
    }
    target.scrollTo(regionScroll(covered, target.maxScroll));
    await frames(2);
    const f = regionFrame(region, target.crop, target.offset, covered);
    if (!f) {
      ctx.warnings.push(STUCK_WARNING);
      break;
    }
    await grabFrame(ctx, index, f.docY, f.crop);
    covered = f.coveredTo;
  }
  return { status: 'complete', size };
}

/** CAPTURE §3: the document, or the largest inner scroller when that is what scrolls. */
function pickTarget(): Target {
  const se = document.scrollingElement ?? document.documentElement;
  const candidates: ScrollCandidate[] = [];
  const els: Element[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!isScroller(el)) continue;
    const r = el.getBoundingClientRect();
    candidates.push({
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
/** Returns warnings, e.g. for overlays it deliberately leaves in place. */
function prepare(log: MutationLog, target: Target): string[] {
  let overlays = 0;
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
    if (r.width * r.height > 0.8 * vpArea) continue;
    if (cs.position === 'sticky') {
      log.setStyle(el, 'position', 'relative');
      for (const side of ['top', 'right', 'bottom', 'left']) log.setStyle(el, side, 'auto');
    } else if (isMidViewportOverlay(r, cs)) {
      // Modals and pop-ups are content the user may want; leave them, but say so (CAPTURE §4).
      overlays++;
    } else if (r.top >= innerHeight / 2) {
      // Bottom-anchored bars (cookie notices, chat bubbles) are hidden in every frame.
      log.setStyle(el, 'visibility', 'hidden');
    } else {
      el.dataset.spFixedTop = '1';
      log.record(() => delete el.dataset.spFixedTop);
    }
  }
  return overlays > 0
    ? [
        'A pop-up or overlay was covering the page and appears in the capture. Close it and capture again to remove it.',
      ]
    : [];
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
async function settle(): Promise<number> {
  await frames(2);
  const visible = [...document.images].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  });
  const pending = await waitForImages(visible, 1500);
  await sleep(150);
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

/** Progress pill in a closed shadow root; hidden while each frame is grabbed (UI §2). */
function makePill() {
  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; top: 8px; right: 8px; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  const pill = document.createElement('div');
  pill.style.cssText =
    'font: 13px system-ui, sans-serif; background: #0e7c7b; color: #fff; padding: 6px 10px; border-radius: 6px;';
  pill.textContent = 'Preparing capture · Esc to cancel';
  root.append(pill);
  document.documentElement.append(host);
  return {
    set: (text: string) => void (pill.textContent = text),
    hide: () => void (host.style.visibility = 'hidden'),
    show: () => void (host.style.visibility = 'visible'),
    remove: () => host.remove(),
    /** Shows a message for a few seconds, then goes away by itself. */
    notice: (text: string) => {
      host.style.visibility = 'visible';
      pill.style.background = '#8a4b00';
      pill.textContent = text;
      setTimeout(() => host.remove(), 6000);
    },
  };
}
