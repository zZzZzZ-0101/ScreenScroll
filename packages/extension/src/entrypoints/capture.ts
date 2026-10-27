import {
  MutationLog,
  STUCK_WARNING,
  chooseScrollTarget,
  isStuck,
  nextStep,
  type Rect,
  type ScrollCandidate,
} from '@scrollpress/core';
import type { CaptureDone, GrabFrame, GrabResult, StartCapture } from '@/lib/messages';

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

interface Target {
  el: Element | null; // null = document
  crop: Rect;
  get offset(): number;
  scrollTo(y: number): void;
  get scrollHeight(): number;
}

async function run(msg: StartCapture): Promise<void> {
  const log = new MutationLog();
  const warnings: string[] = [];
  let cancelled = false;
  let status: CaptureDone['status'] = 'complete';
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancelled = true;
  };
  const onHide = () => {
    cancelled = true;
    log.restore();
  };
  addEventListener('keydown', onKey, true);
  addEventListener('pagehide', onHide);
  const pill = makePill();
  let target: Target | null = null;

  try {
    target = pickTarget();
    const startOffset = target.offset;
    const t = target;
    log.record(() => t.scrollTo(startOffset));
    prepare(log, target);
    await document.fonts.ready;

    const initialScrollHeight = target.scrollHeight;
    let lastOffset: number | null = null;
    for (let index = 0; ; index++) {
      if (cancelled) {
        status = 'cancelled';
        break;
      }
      const step =
        msg.mode === 'visible' && lastOffset !== null
          ? ({ kind: 'stop', reason: 'done', warning: null } as const)
          : nextStep({
              viewportHeight: target.crop.height,
              scrollHeight: target.scrollHeight,
              lastOffset,
              framesTaken: index,
              initialScrollHeight,
            });
      if (step.kind === 'stop') {
        if (step.warning) warnings.push(step.warning);
        break;
      }
      if (msg.mode === 'full') target.scrollTo(step.y);
      await settle();
      const measured = target.offset;
      if (msg.mode === 'full' && isStuck(step.y, measured, lastOffset)) {
        warnings.push(STUCK_WARNING);
        break;
      }
      if (index === 1) hideFixedTop(log);
      pill.set(`Capturing ${index + 1} · Esc to cancel`);
      pill.hide();
      await frames(2);
      const grab: GrabFrame = {
        type: 'sp:grab',
        sessionId: msg.sessionId,
        index,
        docY: measured,
        crop: target.crop,
        viewportWidth: innerWidth,
      };
      const res = (await chrome.runtime.sendMessage(grab)) as GrabResult;
      pill.show();
      if (!res.ok) throw new Error(res.error);
      lastOffset = measured;
    }
  } catch (e) {
    status = 'error';
    warnings.push(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    pill.remove();
    const errors = log.restore();
    if (errors.length) warnings.push(`${errors.length} page change(s) could not be undone.`);
    removeEventListener('keydown', onKey, true);
    removeEventListener('pagehide', onHide);
  }

  const done: CaptureDone = {
    type: 'sp:done',
    sessionId: msg.sessionId,
    status,
    docWidth: target?.crop.width ?? 0,
    docHeight: target?.scrollHeight ?? 0,
    warnings,
  };
  await chrome.runtime.sendMessage(done);
}

function pickTarget(): Target {
  const se = document.scrollingElement ?? document.documentElement;
  const candidates: ScrollCandidate[] = [];
  const els: Element[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollHeight <= el.clientHeight + 2) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    const r = el.getBoundingClientRect();
    // clientLeft/Top skip borders; clientWidth excludes the scrollbar.
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
  if (choice.kind === 'element') {
    const el = els[choice.id]!;
    return {
      el,
      crop: choice.crop,
      get offset() {
        return el.scrollTop;
      },
      scrollTo: (y) => void (el.scrollTop = y),
      get scrollHeight() {
        return el.scrollHeight;
      },
    };
  }
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
  };
}

/** CAPTURE §4, §6: freeze motion, flatten sticky, drop bottom bars and fixed backgrounds. */
function prepare(log: MutationLog, target: Target): void {
  const style = document.createElement('style');
  style.textContent = FREEZE_CSS;
  document.documentElement.append(style);
  log.record(() => style.remove());

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
    } else if (r.top >= innerHeight / 2) {
      // Bottom-anchored bars (cookie notices, chat bubbles) are hidden in every frame.
      log.setStyle(el, 'visibility', 'hidden');
    } else {
      el.dataset.spFixedTop = '1';
      log.record(() => delete el.dataset.spFixedTop);
    }
  }
}

/** Top-anchored fixed headers appear in frame 1 only (CAPTURE §4). */
function hideFixedTop(log: MutationLog): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-sp-fixed-top]')) {
    log.setStyle(el, 'visibility', 'hidden');
  }
}

/** CAPTURE §7: two frames, visible images decoded (1.5 s cap), then a short dwell. */
async function settle(): Promise<void> {
  await frames(2);
  const visible = [...document.images].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 0;
  });
  await Promise.race([
    Promise.all(visible.map((img) => img.decode().catch(() => undefined))),
    sleep(1500),
  ]);
  await sleep(150);
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
  };
}
