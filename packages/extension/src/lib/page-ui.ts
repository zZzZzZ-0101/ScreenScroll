import { normalizeRegion, type Region } from '@scrollpress/core';
import { contentY, isScroller, nearestScroller, targetFor, type Target } from './targets';

/**
 * In-page pickers (UI §2): selection rectangle, element picker and scroll-area picker. They
 * live in a closed shadow root on <html>, outside the page's styles, and are removed before
 * any frame is captured.
 */

const ACCENT = '#0e7c7b';
const EDGE = 36; // px from the viewport edge where dragging auto-scrolls

function overlay(interactive: boolean) {
  const host = document.createElement('div');
  host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: ${interactive ? 'auto' : 'none'};`;
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font: 12px/1.4 system-ui, "Segoe UI", sans-serif; }
    .hint { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); background: #202124;
      color: #fff; padding: 6px 10px; border-radius: 6px; white-space: nowrap; }
    .box { position: fixed; outline: 2px solid ${ACCENT}; box-shadow: 0 0 0 100vmax rgba(0,0,0,.35); }
    .dim { position: fixed; inset: 0; background: rgba(0,0,0,.35); cursor: crosshair; }
    .size { position: absolute; left: 0; top: -22px; background: ${ACCENT}; color: #fff; padding: 1px 6px;
      border-radius: 4px; white-space: nowrap; }
    .handle { position: absolute; width: 10px; height: 10px; background: #fff; border: 2px solid ${ACCENT};
      border-radius: 2px; pointer-events: auto; }
    .outline { position: fixed; outline: 2px solid ${ACCENT}; background: rgba(14,124,123,.12); pointer-events: none; }
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
  return { host, root, el, remove: () => host.remove() };
}

/** Resolves on Enter/Esc; returns a remover for the listener. */
function onKeys(handlers: Record<string, (e: KeyboardEvent) => void>) {
  const listener = (e: KeyboardEvent) => {
    const h = handlers[e.key];
    if (h) {
      e.preventDefault();
      e.stopPropagation();
      h(e);
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
 * Selection mode (UI §2): drag a rectangle, auto-scroll when dragging near the top or bottom
 * edge, adjust with corner handles, Enter captures, Esc cancels. The rectangle is in the
 * content coordinates of whatever scrolls under the pointer where the drag starts.
 */
export function selectRegion(): Promise<Selection | null> {
  return new Promise((resolve) => {
    const ui = overlay(true);
    const hint = ui.el('div', 'hint');
    hint.textContent = 'Drag to select · Enter to capture · Esc to cancel';
    const dim = ui.el('div', 'dim');
    const box = ui.el('div', 'box');
    box.style.display = 'none';
    const size = ui.el('div', 'size', box);
    const handles = (['nw', 'ne', 'sw', 'se'] as const).map((c) => {
      const h = ui.el('div', 'handle', box);
      h.dataset.corner = c;
      h.style.cursor = c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize';
      h.style.display = 'none';
      return h;
    });

    let target: Target | null = null;
    let a: { x: number; y: number } | null = null; // fixed corner (content coords)
    let b: { x: number; y: number } | null = null; // moving corner
    let pointer: { x: number; y: number } | null = null; // last client position while dragging
    let raf = 0;

    const render = () => {
      if (!target || !a || !b) return;
      const r = normalizeRegion(a, b, target.crop.x + target.crop.width, target.scrollHeight);
      const top = r.y0 - target.offset + target.crop.y;
      Object.assign(box.style, {
        display: 'block',
        left: `${r.x0}px`,
        top: `${top}px`,
        width: `${r.x1 - r.x0}px`,
        height: `${r.y1 - r.y0}px`,
      });
      dim.style.display = 'none';
      size.textContent = `${Math.round(r.x1 - r.x0)} × ${Math.round(r.y1 - r.y0)}`;
      const pos = { nw: [0, 0], ne: [1, 0], sw: [0, 1], se: [1, 1] } as const;
      for (const h of handles) {
        const [px, py] = pos[h.dataset.corner as keyof typeof pos];
        h.style.left = `calc(${px * 100}% - 6px)`;
        h.style.top = `calc(${py * 100}% - 6px)`;
      }
    };

    // Auto-scroll while the pointer is held near the top or bottom edge.
    const tick = () => {
      raf = 0;
      if (!target || !pointer || !b) return;
      const t = target;
      const view = t.crop;
      let dy = 0;
      if (pointer.y < view.y + EDGE) dy = -Math.ceil((view.y + EDGE - pointer.y) / 2);
      else if (pointer.y > view.y + view.height - EDGE)
        dy = Math.ceil((pointer.y - (view.y + view.height - EDGE)) / 2);
      if (dy) {
        t.scrollTo(Math.max(0, Math.min(t.maxScroll, t.offset + dy)));
        b = {
          x: pointer.x,
          y: contentY(t, Math.max(view.y, Math.min(view.y + view.height, pointer.y))),
        };
        render();
        raf = requestAnimationFrame(tick);
      }
    };

    const onDown = (e: PointerEvent) => {
      const corner = (e.composedPath()[0] as HTMLElement).dataset?.corner;
      if (corner && a && b && target) {
        // Resize: the opposite corner stays.
        const r = normalizeRegion(a, b, Infinity, Infinity);
        a = { x: corner.includes('w') ? r.x1 : r.x0, y: corner.includes('n') ? r.y1 : r.y0 };
      } else {
        // Find what scrolls under the pointer, looking through our own overlay.
        ui.host.style.pointerEvents = 'none';
        const under = document.elementFromPoint(e.clientX, e.clientY);
        ui.host.style.pointerEvents = 'auto';
        target = targetFor(nearestScroller(under));
        a = { x: e.clientX, y: contentY(target, e.clientY) };
      }
      b = { x: e.clientX, y: contentY(target!, e.clientY) };
      pointer = { x: e.clientX, y: e.clientY };
      for (const h of handles) h.style.display = 'none';
      ui.host.setPointerCapture?.(e.pointerId);
      render();
    };
    const onMove = (e: PointerEvent) => {
      if (!pointer || !target) return;
      pointer = { x: e.clientX, y: e.clientY };
      b = { x: e.clientX, y: contentY(target, e.clientY) };
      render();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onUp = () => {
      pointer = null;
      for (const h of handles) h.style.display = 'block';
    };
    const onScroll = () => render();
    ui.host.addEventListener('pointerdown', onDown);
    ui.host.addEventListener('pointermove', onMove);
    ui.host.addEventListener('pointerup', onUp);
    addEventListener('scroll', onScroll, true);

    const finish = (result: Selection | null) => {
      cancelAnimationFrame(raf);
      removeKeys();
      removeEventListener('scroll', onScroll, true);
      ui.remove();
      resolve(result);
    };
    const removeKeys = onKeys({
      Escape: () => finish(null),
      Enter: () => {
        if (!target || !a || !b) return;
        const r = normalizeRegion(a, b, target.crop.x + target.crop.width, target.scrollHeight);
        if (r.x1 - r.x0 < 4 || r.y1 - r.y0 < 4) return;
        finish({ target, region: r });
      },
    });
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
    const hint = ui.el('div', 'hint');
    hint.textContent = hintText;
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
      const el = e.target instanceof Element ? accept(e.target) : null;
      if (el !== current) {
        trail.length = 0;
        show(el);
      }
    };
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
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
    'Click an element · ↑ parent · ↓ child · Enter to capture · Esc to cancel',
    (el) => {
      if (el === document.documentElement) return null;
      // Shapes inside an SVG aren't useful on their own: offer the whole drawing.
      return el.closest('svg') ?? el;
    },
  );
}

/** "Pick scroll area" (TODO M4, lesson L9): only elements that really scroll are offered. */
export function pickScrollArea(): Promise<Element | null> {
  return pickWith('Click the area that scrolls · Esc to cancel', (el) =>
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
