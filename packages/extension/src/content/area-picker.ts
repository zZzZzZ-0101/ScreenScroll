import { DEFAULT_STYLE, normalizeRegion, type Annotation, type Region } from '@screenscroll/core';
import { overlay, onKeys, type Selection } from './page-ui';
import { contentY, nearestScroller, targetFor, type Target } from './targets';

/**
 * Area mode (UI §2), in the manner of a chat app's screenshot tool: drag a box; then move it,
 * resize it from any corner or edge (left and right included), see its position and size,
 * and use the toolbar under it: a few marks (box, arrow, text, mosaic), undo, extend to the
 * end of the page, and how to finish: copy, save a PDF, cancel, or capture and review.
 *
 * Marks are kept in the content coordinates of whatever scrolls, so they follow the page
 * when it scrolls, and are handed to the Studio as ordinary annotations.
 */

export type AreaOutput = 'studio' | 'pdf' | 'copy';
export interface AreaResult extends Selection {
  output: AreaOutput;
  annotations: Annotation[];
}

type MarkTool = 'rect' | 'arrow' | 'text' | 'pixelate';
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const ACCENT = '#0e7c7b';
const EDGE = 36; // px from the viewport edge where dragging auto-scrolls
const MIN = 4;
const STYLE = { ...DEFAULT_STYLE };

const ICONS: Record<string, string> = {
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  arrow: '<path d="M5 19 19 5M10 5h9v9"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  pixelate: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
  long: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"/>',
  pdf: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  cancel: '<path d="M6 6l12 12M18 6 6 18"/>',
  done: '<path d="M5 12l5 5L20 7"/>',
};

const CSS = `
  :host, * { user-select: none; -webkit-user-drag: none; }
  .edit { user-select: text; }
  .tb { position: fixed; display: flex; align-items: center; gap: 2px; background: #fff; color: #202124;
    border-radius: 8px; padding: 3px; box-shadow: 0 2px 12px rgba(0,0,0,.28); pointer-events: auto; }
  .tb button { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px;
    cursor: pointer; color: #3c4043; }
  .tb button:hover { background: #f1f3f4; }
  .tb button:focus-visible { outline: 2px solid ${ACCENT}; }
  .tb button[aria-pressed="true"] { background: ${ACCENT}; color: #fff; }
  .tb button:disabled { opacity: .35; cursor: default; }
  .tb button.cancel { color: #d93025; } .tb button.done { color: ${ACCENT}; }
  .tb svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2;
    stroke-linecap: round; stroke-linejoin: round; }
  .tb .sep { width: 1px; height: 20px; background: #dadce0; margin: 0 3px; }
  .size { position: absolute; left: 0; top: -24px; background: rgba(32,33,36,.88); color: #fff;
    padding: 2px 7px; border-radius: 4px; white-space: nowrap; font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; }
  .h { position: absolute; width: 9px; height: 9px; background: #fff; border: 2px solid ${ACCENT};
    border-radius: 50%; pointer-events: auto; }
  .box.ready { cursor: move; }
  .box.tool { cursor: crosshair; }
  .marks { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
  .marks text { font: 600 ${STYLE.fontSize}px system-ui, sans-serif; }
  .edit { position: fixed; pointer-events: auto; font: 600 ${STYLE.fontSize}px system-ui, sans-serif;
    color: ${STYLE.color}; background: rgba(255,255,255,.9); border: 1px dashed ${STYLE.color};
    outline: none; padding: 0 2px; min-width: 40px; }
`;

const HANDLES: Array<[Handle, number, number, string]> = [
  ['nw', 0, 0, 'nwse-resize'],
  ['n', 0.5, 0, 'ns-resize'],
  ['ne', 1, 0, 'nesw-resize'],
  ['e', 1, 0.5, 'ew-resize'],
  ['se', 1, 1, 'nwse-resize'],
  ['s', 0.5, 1, 'ns-resize'],
  ['sw', 0, 1, 'nesw-resize'],
  ['w', 0, 0.5, 'ew-resize'],
];

export function pickArea(): Promise<AreaResult | null> {
  return new Promise((resolve) => {
    const ui = overlay(true);
    const style = document.createElement('style');
    style.textContent = CSS;
    ui.root.append(style);
    const dim = ui.el('div', 'dim');
    const box = ui.el('div', 'box');
    box.style.display = 'none';
    const size = ui.el('div', 'size', box);
    const handles = HANDLES.map(([name, , , cursor]) => {
      const h = ui.el('div', 'h', box);
      h.dataset.h = name;
      h.style.cursor = cursor;
      return h;
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'marks');
    ui.root.append(svg);
    const hint = ui.hint(() => finish(null));
    const tb = ui.el('div', 'tb');
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', 'Area capture');
    tb.style.display = 'none';

    let target: Target | null = null;
    /** The area in the target's content coordinates (x as in the viewport). */
    let r: Region | null = null;
    let tool: MarkTool | null = null;
    const marks: Annotation[] = [];
    let draft: Annotation | null = null;
    let editing: { input: HTMLInputElement; x: number; y: number } | null = null;
    let drag:
      | { kind: 'new'; a: { x: number; y: number } }
      | { kind: 'resize'; handle: Handle }
      | { kind: 'move'; from: { x: number; y: number }; start: Region }
      | { kind: 'mark'; from: { x: number; y: number } }
      | null = null;
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let seq = 0;

    const button = (name: string, label: string, onClick: () => void, cls = '') => {
      const b = ui.el('button', cls, tb);
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label.replace(/ \(.*\)$/, ''));
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    const sep = () => ui.el('span', 'sep', tb);
    const toolButtons = (
      [
        ['rect', 'Box (R)'],
        ['arrow', 'Arrow (A)'],
        ['text', 'Text (T)'],
        ['pixelate', 'Mosaic: hide what is under it (M)'],
      ] as const
    ).map(([t, label]) => {
      const b = button(t, label, () => setTool(tool === t ? null : t));
      b.setAttribute('aria-pressed', 'false');
      return [t, b] as const;
    });
    sep();
    const undoBtn = button('undo', 'Undo (Ctrl+Z)', () => undo());
    sep();
    button('long', 'Extend to the end of the page; drag the bottom edge to adjust', () => extend());
    sep();
    button('copy', 'Copy as image (Ctrl+C)', () => done('copy'));
    button('pdf', 'Save as PDF (Ctrl+S)', () => done('pdf'));
    sep();
    button('cancel', 'Cancel (Esc)', () => finish(null), 'cancel');
    button('done', 'Capture and review (Enter)', () => done('studio'), 'done');

    const setTool = (t: MarkTool | null) => {
      commitText();
      tool = t;
      for (const [name, b] of toolButtons) b.setAttribute('aria-pressed', String(name === t));
      render();
    };

    const toView = (y: number) => y - target!.offset + target!.crop.y;
    const at = (e: { clientX: number; clientY: number }) => ({
      x: e.clientX,
      y: contentY(target!, e.clientY),
    });
    const inside = (p: { x: number; y: number }) =>
      !!r && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
    const clampToContent = (q: Region): Region => {
      const t = target!;
      const W = t.crop.x + t.crop.width;
      const H = t.scrollHeight;
      return normalizeRegion({ x: q.x0, y: q.y0 }, { x: q.x1, y: q.y1 }, W, H);
    };

    const render = () => {
      if (!target || !r) {
        tb.style.display = 'none';
        return;
      }
      const top = toView(r.y0);
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      Object.assign(box.style, {
        display: 'block',
        left: `${r.x0}px`,
        top: `${top}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
      box.className = `box${drag?.kind === 'new' ? '' : tool ? ' tool' : ' ready'}`;
      dim.style.display = 'none';
      size.textContent = `x ${Math.round(r.x0)}  y ${Math.round(r.y0)}  ·  ${Math.round(w)} × ${Math.round(h)}`;
      const showHandles = drag?.kind !== 'new';
      for (const [i, [, fx, fy]] of HANDLES.entries()) {
        const el = handles[i]!;
        el.style.display = showHandles ? 'block' : 'none';
        el.style.left = `calc(${fx * 100}% - 6.5px)`;
        el.style.top = `calc(${fy * 100}% - 6.5px)`;
      }
      // Marks, in viewport coordinates.
      svg.replaceChildren(...[...marks, ...(draft ? [draft] : [])].map(markSvg));
      undoBtn.disabled = !marks.length;
      // Toolbar: under the box, right-aligned; above it, or inside, when there's no room.
      if (drag?.kind === 'new') {
        tb.style.display = 'none';
        return;
      }
      tb.style.display = 'flex';
      const tw = tb.offsetWidth;
      const th = tb.offsetHeight;
      const bottom = top + h;
      let y = bottom + 8;
      if (y + th > innerHeight - 4) y = top - th - 8;
      if (y < 4) y = Math.min(innerHeight - th - 8, Math.max(4, bottom - th - 8));
      const x = Math.max(4, Math.min(innerWidth - tw - 4, r.x1 - tw));
      tb.style.left = `${x}px`;
      tb.style.top = `${y}px`;
      hint.set(
        tool
          ? 'Draw on the area · press the tool again to stop drawing · Press Esc to cancel'
          : 'Drag to move · drag the edges to resize · Enter to capture · Press Esc to cancel',
      );
    };

    const NS = 'http://www.w3.org/2000/svg';
    const markSvg = (m: Annotation): SVGElement => {
      const stroke = { stroke: m.style.color, 'stroke-width': String(m.style.width), fill: 'none' };
      const make = (tag: string, attrs: Record<string, string>) => {
        const el = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
      };
      switch (m.kind) {
        case 'rect':
          return make('rect', {
            x: `${m.x}`,
            y: `${toView(m.y)}`,
            width: `${m.w}`,
            height: `${m.h}`,
            ...stroke,
          });
        case 'pixelate':
          return make('rect', {
            x: `${m.x}`,
            y: `${toView(m.y)}`,
            width: `${m.w}`,
            height: `${m.h}`,
            fill: 'rgba(60,64,67,.55)',
            stroke: '#3c4043',
            'stroke-dasharray': '4 3',
          });
        case 'arrow': {
          const g = make('g', {});
          const y1 = toView(m.y1);
          const y2 = toView(m.y2);
          const ang = Math.atan2(y2 - y1, m.x2 - m.x1);
          const len = 6 + 3 * m.style.width;
          const wing = (d: number) =>
            `${m.x2 - len * Math.cos(ang + d)},${y2 - len * Math.sin(ang + d)}`;
          g.append(
            make('line', { x1: `${m.x1}`, y1: `${y1}`, x2: `${m.x2}`, y2: `${y2}`, ...stroke }),
            make('polyline', {
              points: `${wing(0.5)} ${m.x2},${y2} ${wing(-0.5)}`,
              ...stroke,
              'stroke-linejoin': 'round',
            }),
          );
          return g;
        }
        case 'text': {
          const t = make('text', {
            x: `${m.x}`,
            y: `${toView(m.y) + m.style.fontSize}`,
            fill: m.style.color,
          });
          t.textContent = m.text;
          return t;
        }
        default:
          return make('g', {});
      }
    };

    const markFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Annotation => {
      const id = `area-${++seq}`;
      if (tool === 'arrow')
        return { id, kind: 'arrow', style: STYLE, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      return {
        id,
        kind: tool === 'pixelate' ? 'pixelate' : 'rect',
        style: STYLE,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      };
    };

    const startText = (p: { x: number; y: number }) => {
      commitText();
      const input = document.createElement('input');
      input.className = 'edit';
      input.setAttribute('aria-label', 'Text');
      input.style.left = `${p.x}px`;
      input.style.top = `${toView(p.y)}px`;
      ui.root.append(input);
      editing = { input, x: p.x, y: p.y };
      // Enter and Esc reach the picker's key handler first (see `onKeys` below).
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      // Focus synchronously, so keys typed right after the click land here.
      input.focus();
    };
    const commitText = () => {
      if (!editing) return;
      const { input, x, y } = editing;
      editing = null;
      input.remove();
      const text = input.value.trim();
      if (text) marks.push({ id: `area-${++seq}`, kind: 'text', style: STYLE, x, y, text });
      render();
    };
    const undo = () => {
      commitText();
      marks.pop();
      render();
    };
    const extend = () => {
      if (!target || !r) return;
      r = { ...r, y1: target.scrollHeight };
      render();
    };

    /** Applies the current drag to the pointer position `p` (content coordinates). */
    const apply = (p: { x: number; y: number }) => {
      if (!drag || !target) return;
      if (drag.kind === 'new') {
        r = normalizeRegion(drag.a, p, target.crop.x + target.crop.width, target.scrollHeight);
      } else if (drag.kind === 'resize' && r) {
        const n = { ...r };
        if (drag.handle.includes('n')) n.y0 = p.y;
        if (drag.handle.includes('s')) n.y1 = p.y;
        if (drag.handle.includes('w')) n.x0 = p.x;
        if (drag.handle.includes('e')) n.x1 = p.x;
        r = clampToContent(n);
        // Crossing the opposite edge flips which edge is held.
        const flip: Record<string, string> = { n: 's', s: 'n', e: 'w', w: 'e' };
        let h = drag.handle as string;
        if ((h.includes('n') && p.y > r.y0 + 0.5) || (h.includes('s') && p.y < r.y1 - 0.5))
          h = h.replace(/[ns]/, (c) => flip[c]!);
        if ((h.includes('w') && p.x > r.x0 + 0.5) || (h.includes('e') && p.x < r.x1 - 0.5))
          h = h.replace(/[ew]/, (c) => flip[c]!);
        drag.handle = h as Handle;
      } else if (drag.kind === 'move') {
        const t = target;
        const s = drag.start;
        const w = s.x1 - s.x0;
        const h = s.y1 - s.y0;
        const x0 = Math.max(
          t.crop.x,
          Math.min(t.crop.x + t.crop.width - w, s.x0 + p.x - drag.from.x),
        );
        const y0 = Math.max(0, Math.min(t.scrollHeight - h, s.y0 + p.y - drag.from.y));
        r = { x0, x1: x0 + w, y0, y1: y0 + h };
      } else if (drag.kind === 'mark') {
        draft = markFrom(drag.from, p);
      }
      render();
    };

    // Auto-scroll while the pointer is held near the top or bottom edge.
    const tick = () => {
      raf = 0;
      if (!target || !pointer || !drag) return;
      const t = target;
      const view = t.crop;
      let dy = 0;
      if (pointer.y < view.y + EDGE) dy = -Math.ceil((view.y + EDGE - pointer.y) / 2);
      else if (pointer.y > view.y + view.height - EDGE)
        dy = Math.ceil((pointer.y - (view.y + view.height - EDGE)) / 2);
      if (dy) {
        t.scrollTo(Math.max(0, Math.min(t.maxScroll, t.offset + dy)));
        const y = Math.max(view.y, Math.min(view.y + view.height, pointer.y));
        apply({ x: pointer.x, y: contentY(t, y) });
        raf = requestAnimationFrame(tick);
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.target as HTMLElement;
      if (el.closest?.('.tb, .hint, .edit')) return;
      pointer = { x: e.clientX, y: e.clientY };
      const handle = el.dataset?.h as Handle | undefined;
      if (handle && r) {
        commitText();
        drag = { kind: 'resize', handle };
      } else if (r && target && inside(at(e)) && tool === 'text') {
        startText(at(e));
        e.preventDefault();
        return;
      } else if (r && target && inside(at(e)) && tool) {
        commitText();
        drag = { kind: 'mark', from: at(e) };
      } else if (r && target && inside(at(e))) {
        commitText();
        drag = { kind: 'move', from: at(e), start: r };
      } else {
        // A new area, unless marks would be lost with the old one.
        if (marks.length) return;
        commitText();
        ui.host.style.pointerEvents = 'none';
        const under = document.elementFromPoint(e.clientX, e.clientY);
        ui.host.style.pointerEvents = 'auto';
        target = targetFor(nearestScroller(under));
        drag = { kind: 'new', a: at(e) };
      }
      // No text selection or native drag under our drag: the browser would cancel it.
      e.preventDefault();
      ui.host.setPointerCapture?.(e.pointerId);
      apply(at(e));
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || !target) return;
      pointer = { x: e.clientX, y: e.clientY };
      apply(at(e));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onUp = () => {
      if (drag?.kind === 'mark' && draft) {
        const big =
          draft.kind === 'arrow'
            ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > MIN
            : 'w' in draft && draft.w > MIN && draft.h > MIN;
        if (big) marks.push(draft);
      }
      draft = null;
      drag = null;
      pointer = null;
      render();
    };
    const onScroll = () => {
      if (editing) editing.input.style.top = `${toView(editing.y)}px`;
      render();
    };
    // Down on the shadow root, to see which part was hit; move and up on the host, which
    // holds the pointer capture.
    ui.root.addEventListener('pointerdown', onDown as EventListener);
    // The mousedown after the click that opened a text box would move focus away from it.
    ui.root.addEventListener('mousedown', (e) => {
      if (editing && e.target !== editing.input) e.preventDefault();
    });
    ui.host.addEventListener('pointermove', onMove);
    ui.host.addEventListener('pointerup', onUp);
    ui.host.addEventListener('pointercancel', onUp);
    addEventListener('scroll', onScroll, true);

    const nudge = (dx: number, dy: number, e: KeyboardEvent) => {
      if (!r || !target) return;
      const k = e.shiftKey ? 10 : 1;
      const s = r;
      drag = { kind: 'move', from: { x: 0, y: 0 }, start: s };
      apply({ x: dx * k, y: dy * k });
      drag = null;
      render();
    };

    const done = (output: AreaOutput) => {
      commitText();
      if (!target || !r) return;
      const q = clampToContent(r);
      if (q.x1 - q.x0 < MIN || q.y1 - q.y0 < MIN) return;
      // Marks move to the area's own coordinates, which the Studio uses.
      const shift = (m: Annotation): Annotation => {
        switch (m.kind) {
          case 'arrow':
          case 'line':
            return { ...m, x1: m.x1 - q.x0, y1: m.y1 - q.y0, x2: m.x2 - q.x0, y2: m.y2 - q.y0 };
          case 'pen':
          case 'highlighter':
            return {
              ...m,
              points: m.points.map((v, i) => v - (i % 2 === 0 ? q.x0 : q.y0)),
            };
          default:
            return { ...m, x: m.x - q.x0, y: m.y - q.y0 };
        }
      };
      finish({ target, region: q, output, annotations: marks.map(shift) });
    };

    const finish = (result: AreaResult | null) => {
      cancelAnimationFrame(raf);
      removeKeys();
      removeEventListener('scroll', onScroll, true);
      ui.remove();
      resolve(result);
    };
    const key = (k: string) => (e: KeyboardEvent) => {
      if (editing) return false;
      const mod = e.ctrlKey || e.metaKey;
      if (k === 'z' && mod) undo();
      else if (k === 'c' && mod) done('copy');
      else if (k === 's' && mod) done('pdf');
      else if (!mod && r) {
        const map: Record<string, MarkTool> = { r: 'rect', a: 'arrow', t: 'text', m: 'pixelate' };
        const t = map[k];
        if (!t) return false;
        setTool(tool === t ? null : t);
      } else return false;
    };
    const removeKeys = onKeys({
      Escape: () => {
        if (editing) {
          editing.input.remove();
          editing = null;
        } else finish(null);
      },
      Enter: () => (editing ? commitText() : done('studio')),
      ArrowLeft: (e) => (editing ? false : nudge(-1, 0, e)),
      ArrowRight: (e) => (editing ? false : nudge(1, 0, e)),
      ArrowUp: (e) => (editing ? false : nudge(0, -1, e)),
      ArrowDown: (e) => (editing ? false : nudge(0, 1, e)),
      ...Object.fromEntries(['z', 'c', 's', 'r', 'a', 't', 'm'].map((k) => [k, key(k)])),
    });
    hint.set('Drag to select an area · Press Esc to cancel');
  });
}
