import type { Region } from '@screenscroll/core';
import { contentY, isScroller, nearestScroller, targetFor, type Target } from './targets';

/**
 * In-page pickers (UI §2): line to line, element and scroll area (area mode is in
 * area-picker.ts). They
 * live in a closed shadow root on <html>, outside the page's styles, and are removed before
 * any frame is captured.
 */

const ACCENT = '#0e7c7b';

export function overlay(interactive: boolean) {
  const host = document.createElement('div');
  host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: ${interactive ? 'auto' : 'none'};`;
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font: 12px/1.4 system-ui, "Segoe UI", sans-serif; }
    .hint { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); background: #202124;
      color: #fff; padding: 5px 5px 5px 12px; border-radius: 10px; white-space: nowrap; display: flex;
      align-items: center; gap: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.3); pointer-events: auto;
      max-width: calc(100vw - 16px); }
    .hint span { overflow: hidden; text-overflow: ellipsis; }
    kbd { border: 1px solid #9aa0a6; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px;
      font-weight: 600; }
    .hint button { all: unset; cursor: pointer; border: 1px solid #5f6368; border-radius: 6px;
      padding: 2px 10px; color: #e8eaed; }
    .hint button:hover { background: #3c4043; }
    .hint button:focus-visible { outline: 2px solid #8ab4f8; }
    .box { position: fixed; outline: 2px solid ${ACCENT}; box-shadow: 0 0 0 100vmax rgba(0,0,0,.35); }
    .dim { position: fixed; inset: 0; background: rgba(0,0,0,.35); cursor: crosshair; }
    .size { position: absolute; left: 0; top: -22px; background: ${ACCENT}; color: #fff; padding: 1px 6px;
      border-radius: 4px; white-space: nowrap; }
    .handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 2px solid ${ACCENT};
      border-radius: 2px; pointer-events: auto; }
    .outline { position: fixed; outline: 2px solid ${ACCENT}; background: rgba(14,124,123,.12); pointer-events: none; }
    .line { position: fixed; height: 0; border-top: 2px solid ${ACCENT}; pointer-events: none; }
    .line.start { border-top-style: dashed; }
    .tag { position: absolute; left: 8px; top: -24px; background: ${ACCENT}; color: #fff; padding: 2px 8px;
      border-radius: 4px; white-space: nowrap; }
    .band { position: fixed; background: rgba(14,124,123,.14); pointer-events: none; }
    .label { position: absolute; left: -2px; top: -22px; background: ${ACCENT}; color: #fff; padding: 1px 6px;
      border-radius: 4px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
  `;
  root.append(style);
  document.documentElement.append(host);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: Node = root) => {
    const e = document.createElement(tag);
    e.className = cls;
    parent.appendChild(e);
    return e;
  };
  /**
   * The hint bar at the top: what to do, and always how to get out (Esc or the Cancel
   * button), so a picker opened by mistake is never a trap. `set` takes plain text in which
   * "Esc", "Enter" and "Backspace" are shown as keys.
   */
  const hint = (onCancel: () => void) => {
    const bar = el('div', 'hint');
    const text = el('span', '', bar);
    // Not the start of a drag in the selection picker.
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    const cancel = el('button', '', bar);
    cancel.textContent = 'Cancel';
    cancel.title = 'Stop without capturing (Esc)';
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      onCancel();
    });
    return {
      set(t: string) {
        text.replaceChildren(
          ...t.split(/\b(Esc|Enter|Backspace)\b/).map((part, i) => {
            if (i % 2 === 0) return document.createTextNode(part);
            const k = document.createElement('kbd');
            k.textContent = part;
            return k;
          }),
        );
      },
    };
  };
  /** Events on our own UI (the hint bar), which the pickers must not treat as page clicks. */
  const ours = (e: Event) => e.target === host;
  return { host, root, el, hint, ours, remove: () => host.remove() };
}

/**
 * Key handlers for a picker; returns a remover. A handler that returns false leaves the key
 * to the page (e.g. letters typed into a text mark).
 */
export function onKeys(handlers: Record<string, (e: KeyboardEvent) => void | false>) {
  const listener = (e: KeyboardEvent) => {
    const h = handlers[e.key];
    if (h && h(e) !== false) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  addEventListener('keydown', listener, true);
  return () => removeEventListener('keydown', listener, true);
}

export interface Selection {
  target: Target;
  region: Region;
}

/**
 * "From line to line" (UI §2): click the first line, scroll freely (wheel, keys, scrollbar),
 * click the last line. Everything between is captured at the full width of whatever scrolls
 * under the first click, however long. Enter ends at the bottom; Backspace picks the start
 * again; Esc cancels.
 */
export function pickLines(): Promise<Selection | null> {
  return new Promise((resolve) => {
    const ui = overlay(false);
    const hint = ui.hint(() => finish(null));
    const band = ui.el('div', 'band');
    const startLine = ui.el('div', 'line start');
    const startTag = ui.el('div', 'tag', startLine);
    startTag.textContent = 'Start';
    const line = ui.el('div', 'line');
    const tag = ui.el('div', 'tag', line);
    let target: Target | null = null;
    let startY: number | null = null;
    let pointer = { x: innerWidth / 2, y: innerHeight / 2 };

    const targetAt = (x: number, y: number) =>
      targetFor(nearestScroller(document.elementFromPoint(x, y)));
    const clampY = (t: Target, y: number) =>
      Math.max(t.crop.y, Math.min(t.crop.y + t.crop.height, y));
    const place = (el: HTMLElement, t: Target, y: number) =>
      Object.assign(el.style, {
        display: 'block',
        left: `${t.crop.x}px`,
        width: `${t.crop.width}px`,
        top: `${y}px`,
      });

    const render = () => {
      const t = target ?? targetAt(pointer.x, pointer.y);
      const y = clampY(t, pointer.y);
      place(line, t, y);
      if (startY === null) {
        hint.set('Click the first line to capture · Press Esc to cancel');
        tag.textContent = 'Start here';
        startLine.style.display = 'none';
        band.style.display = 'none';
        return;
      }
      hint.set(
        'Scroll to the last line and click it · Enter = to the end · Backspace = new start · Esc to cancel',
      );
      const sy = startY - t.offset + t.crop.y; // start line in viewport coordinates
      const shown = sy >= t.crop.y && sy <= t.crop.y + t.crop.height;
      startLine.style.display = shown ? 'block' : 'none';
      if (shown) place(startLine, t, sy);
      const top = clampY(t, Math.min(sy, y));
      const bottom = clampY(t, Math.max(sy, y));
      Object.assign(band.style, {
        display: 'block',
        left: `${t.crop.x}px`,
        width: `${t.crop.width}px`,
        top: `${top}px`,
        height: `${bottom - top}px`,
      });
      const height = Math.round(Math.abs(contentY(t, y) - startY));
      tag.textContent = `End here · ${height} px`;
    };

    const finish = (result: Selection | null) => {
      removeKeys();
      removeEventListener('mousemove', onMove, true);
      removeEventListener('click', onClick, true);
      removeEventListener('mousedown', block, true);
      removeEventListener('mouseup', block, true);
      removeEventListener('scroll', render, true);
      ui.remove();
      resolve(result);
    };
    const select = (t: Target, a: number, b: number) =>
      finish({
        target: t,
        region: {
          x0: t.crop.x,
          x1: t.crop.x + t.crop.width,
          y0: Math.max(0, Math.min(a, b)),
          y1: Math.min(t.scrollHeight, Math.max(a, b)),
        },
      });
    const onMove = (e: MouseEvent) => {
      if (ui.ours(e)) return;
      pointer = { x: e.clientX, y: e.clientY };
      render();
    };
    const block = (e: Event) => {
      if (ui.ours(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (ui.ours(e)) return;
      block(e);
      pointer = { x: e.clientX, y: e.clientY };
      if (startY === null || !target) {
        target = targetAt(e.clientX, e.clientY);
        startY = contentY(target, clampY(target, e.clientY));
        render();
      } else {
        select(target, startY, contentY(target, clampY(target, e.clientY)));
      }
    };
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('mousedown', block, true);
    addEventListener('mouseup', block, true);
    addEventListener('scroll', render, true);
    const removeKeys = onKeys({
      Escape: () => finish(null),
      Enter: () => {
        if (target && startY !== null) select(target, startY, target.scrollHeight);
      },
      Backspace: () => {
        target = null;
        startY = null;
        render();
      },
    });
    render();
  });
}

function describe(el: Element): string {
  const r = el.getBoundingClientRect();
  const id = el.id ? `#${el.id}` : '';
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
  return `${el.tagName.toLowerCase()}${id}${cls} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
}

/**
 * Hover-outline picker shared by element mode and scroll-area mode. `accept` maps the element
 * under the pointer to the one to highlight (or null). ↑ / ↓ climb to the parent / back down.
 */
function pickWith(
  hintText: string,
  accept: (el: Element) => Element | null,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const ui = overlay(false);
    ui.hint(() => finish(null)).set(hintText);
    const outline = ui.el('div', 'outline');
    const label = ui.el('div', 'label', outline);
    outline.style.display = 'none';
    let current: Element | null = null;
    const trail: Element[] = []; // children we climbed up from, for ↓

    const show = (el: Element | null) => {
      current = el;
      if (!el) {
        outline.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(outline.style, {
        display: 'block',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      label.textContent = describe(el);
    };
    const onMove = (e: MouseEvent) => {
      if (ui.ours(e)) return;
      const el = e.target instanceof Element ? accept(e.target) : null;
      if (el !== current) {
        trail.length = 0;
        show(el);
      }
    };
    const block = (e: Event) => {
      if (ui.ours(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      if (ui.ours(e)) return;
      block(e);
      if (current) finish(current);
    };
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('mousedown', block, true);
    addEventListener('mouseup', block, true);
    const finish = (el: Element | null) => {
      removeKeys();
      removeEventListener('mousemove', onMove, true);
      removeEventListener('click', onClick, true);
      removeEventListener('mousedown', block, true);
      removeEventListener('mouseup', block, true);
      ui.remove();
      resolve(el);
    };
    const removeKeys = onKeys({
      Escape: () => finish(null),
      Enter: () => current && finish(current),
      ArrowUp: () => {
        const parent = current?.parentElement;
        if (current && parent && parent !== document.documentElement) {
          const up = accept(parent);
          if (up) {
            trail.push(current);
            show(up);
          }
        }
      },
      ArrowDown: () => {
        const back =
          trail.pop() ??
          [...(current?.children ?? [])].find((c) => c.getBoundingClientRect().height > 0);
        if (back) show(accept(back) ?? back);
      },
    });
  });
}

/** Element mode (UI §2, CAPTURE §14). */
export function pickElement(): Promise<Element | null> {
  return pickWith(
    'Click an element · ↑ parent · ↓ child · Enter to capture · Press Esc to cancel',
    (el) => {
      if (el === document.documentElement) return null;
      // Shapes inside an SVG aren't useful on their own: offer the whole drawing.
      return el.closest('svg') ?? el;
    },
  );
}

/** "Pick scroll area" (TODO M4, lesson L9): only elements that really scroll are offered. */
export function pickScrollArea(): Promise<Element | null> {
  return pickWith('Click the area that scrolls · Press Esc to cancel', (el) =>
    isScroller(el) ? el : nearestScroller(el),
  );
}

/** The element as a region of whatever scrolls around it. */
export function elementRegion(el: Element): Selection {
  const target = targetFor(nearestScroller(el.parentElement));
  const r = el.getBoundingClientRect();
  return {
    target,
    region: {
      x0: r.left,
      x1: r.right,
      y0: contentY(target, r.top),
      y1: contentY(target, r.bottom),
    },
  };
}
