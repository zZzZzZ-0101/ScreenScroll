/**
 * The capture pill (UI §2): says what is happening and how to stop it, and stays on screen
 * for the whole capture. It never hides for a frame grab (a flashing hint is unreadable);
 * instead frames leave out the rows it covers (core `nextStep`). It sits at the bottom
 * centre and moves to the top for the last frame only.
 *
 * Lives in a closed shadow root on <html>, outside the page's styles and outside what hint
 * collection walks.
 */
import { t } from '@/shared/i18n';

export type PillPlace = 'bottom' | 'top';

/** Space between the pill and the screen edge, and around it in the strip frames skip. */
const GAP = 10;
const MAX_WIDTH = 640;

export interface PillActions {
  /** Pause capture between frames. */
  onPause?: () => void;
  /** Resume a paused capture. */
  onResume?: () => void;
  /** Keep what was captured so far and open it. */
  onStop?: () => void;
  /** Throw everything away (also Esc). */
  onCancel?: () => void;
}

export function makePill(actions: PillActions = {}) {
  const host = document.createElement('div');
  host.dataset.screenscroll = 'pill';
  host.style.cssText = `all: initial; position: fixed; left: 50%; bottom: ${GAP}px; transform: translateX(-50%); z-index: 2147483647; max-width: min(${MAX_WIDTH}px, calc(100vw - 16px));`;
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font: 13px/1.3 system-ui, "Segoe UI", sans-serif; }
    .pill { position: relative; overflow: hidden; display: flex; align-items: center; gap: 10px;
      background: #202124; color: #fff; padding: 6px 6px 8px 12px; border-radius: 10px;
      border: 2px solid transparent; box-shadow: 0 2px 10px rgba(0,0,0,.3); white-space: nowrap; }
    .pill.alert { border-color: #f9ab00; }
    .pill.notice { background: #8a4b00; padding: 8px 12px; white-space: normal; }
    .pill.done { background: #0e7c7b; padding: 8px 12px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #f28b82; flex: none; }
    .dot.paused { background: #f9ab00; }
    .text { overflow: hidden; text-overflow: ellipsis; }
    kbd { display: inline-block; border: 1px solid #9aa0a6; border-bottom-width: 2px; border-radius: 4px;
      padding: 0 5px; margin: 0 2px; font: 600 12px/1.4 system-ui, sans-serif; color: #fff; }
    button { all: unset; cursor: pointer; border-radius: 6px; padding: 4px 10px; font: 13px system-ui, sans-serif; }
    button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
    .pause { color: #e8eaed; border: 1px solid #5f6368; }
    .pause:hover { background: #3c4043; }
    .stop { background: #fff; color: #202124; font-weight: 600; }
    .cancel { color: #e8eaed; border: 1px solid #5f6368; }
    .stop:hover { background: #e8eaed; } .cancel:hover { background: #3c4043; }
    .track { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.14); display: none; }
    .bar { height: 100%; width: 0%; background: #0e7c7b; transition: width 120ms linear; }
    @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
  `;
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  const dot = document.createElement('span');
  dot.className = 'dot';
  const text = document.createElement('span');
  text.className = 'text';
  const how = document.createElement('span');
  how.innerHTML = t('Press <kbd>Esc</kbd> to cancel');
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'pause';
  pauseBtn.textContent = t('Pause');
  pauseBtn.title = t('Pause capture');
  let isPaused = false;
  pauseBtn.onclick = () => (isPaused ? actions.onResume?.() : actions.onPause?.());
  const stop = document.createElement('button');
  stop.className = 'stop';
  stop.textContent = t('Stop here');
  stop.title = t('Stop now and keep what is captured so far');
  stop.onclick = () => actions.onStop?.();
  const cancel = document.createElement('button');
  cancel.className = 'cancel';
  cancel.textContent = t('Cancel');
  cancel.title = t('Stop and keep nothing (Esc)');
  cancel.onclick = () => actions.onCancel?.();
  const track = document.createElement('div');
  track.className = 'track';
  const bar = document.createElement('div');
  bar.className = 'bar';
  track.append(bar);
  pill.append(dot, text, how, pauseBtn, stop, cancel, track);
  root.append(style, pill);
  document.documentElement.append(host);

  let base = '';
  let alertTimer = 0;
  const show = (el: HTMLElement, on: boolean) => void (el.style.display = on ? '' : 'none');
  pauseBtn.style.display = 'none';
  stop.style.display = 'none';

  const api = {
    host,
    /** Main line, e.g. "Capturing · screen 3 of ~12". */
    set(t: string) {
      base = t;
      if (!alertTimer) text.textContent = t;
    },
    /** Whether Pause / Resume is available now. */
    canPause(on: boolean) {
      show(pauseBtn, on && !!(actions.onPause && actions.onResume));
    },
    /** Reflects paused state on the pill button and indicator dot. */
    setPaused(paused: boolean) {
      isPaused = paused;
      dot.classList.toggle('paused', paused);
      pauseBtn.textContent = paused ? t('Resume') : t('Pause');
      pauseBtn.title = paused ? t('Resume capture') : t('Pause capture');
      pauseBtn.setAttribute('aria-pressed', String(paused));
      if (paused) host.dataset.paused = '1';
      else delete host.dataset.paused;
    },
    /** Updates the thin progress bar along the bottom edge of the pill. */
    progress(done: number, total: number | null) {
      if (total === null || total <= 0 || !Number.isFinite(total)) {
        track.style.display = 'none';
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
      track.style.display = 'block';
      bar.style.width = `${pct}%`;
    },
    /** Whether "Stop here" (keep what's captured) makes sense yet. */
    canStop(on: boolean) {
      show(stop, on && !!actions.onStop);
    },
    place(p: PillPlace) {
      host.style.top = p === 'top' ? `${GAP}px` : '';
      host.style.bottom = p === 'bottom' ? `${GAP}px` : '';
    },
    /** For the very rare box too small to share with the pill. */
    hide: () => void (host.style.visibility = 'hidden'),
    show: () => void (host.style.visibility = 'visible'),
    /**
     * The user scrolled, clicked or typed during the capture: say, without flashing, that
     * the page is paused and how to stop. Goes back to the normal line after a few seconds.
     */
    alert(message = t('Capturing, so the page is paused.')) {
      pill.classList.add('alert');
      host.dataset.alert = message;
      text.textContent = message;
      clearTimeout(alertTimer);
      alertTimer = window.setTimeout(() => {
        alertTimer = 0;
        pill.classList.remove('alert');
        delete host.dataset.alert;
        text.textContent = base;
      }, 3500);
    },
    /**
     * Height of the screen strip the pill covers at `p`, including a small gap, and its
     * horizontal extent: frames leave this strip out.
     */
    strip(p: PillPlace): { height: number; x0: number; x1: number } {
      const r = host.getBoundingClientRect();
      // Use the widest the pill can get, so a longer text later never overlaps kept rows.
      const w = Math.min(MAX_WIDTH, innerWidth - 16);
      return {
        height: (p === 'top' ? GAP : 0) + Math.ceil(r.height) + GAP + (p === 'bottom' ? GAP : 0),
        x0: innerWidth / 2 - w / 2,
        x1: innerWidth / 2 + w / 2,
      };
    },
    remove: () => {
      clearTimeout(alertTimer);
      host.remove();
    },
    /** Replaces the controls with a message that goes away by itself. */
    notice(t: string, kind: 'notice' | 'done' = 'notice', ms = 6000) {
      clearTimeout(alertTimer);
      alertTimer = 0;
      api.place('bottom');
      host.style.visibility = 'visible';
      track.style.display = 'none';
      pill.className = `pill ${kind}`;
      pill.replaceChildren(t);
      // Readable from outside the closed root (tests, and anyone inspecting the page).
      host.dataset.message = t;
      setTimeout(() => host.remove(), ms);
    },
  };
  return api;
}

export type Pill = ReturnType<typeof makePill>;
