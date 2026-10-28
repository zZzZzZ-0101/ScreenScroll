import type { Px, Rect } from './geometry.js';
import type { Forbidden } from './hints.js';

/**
 * Annotations (UI §3 Annotate tab) live in document coordinates, so they survive
 * re-pagination and are drawn into each page image at export (TODO M4).
 */
export type Tool =
  | 'select'
  | 'crop'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'step'
  | 'blur'
  | 'pixelate';

/** Single-key shortcuts from UI §3. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  c: 'crop',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
  h: 'highlighter',
  t: 'text',
  n: 'step',
  b: 'blur',
  x: 'pixelate',
};

export interface Style {
  color: string;
  /** Stroke width in CSS px (document units). */
  width: number;
  fontSize: number;
}

export const DEFAULT_STYLE: Style = { color: '#d93025', width: 3, fontSize: 18 };

export type BoxKind = 'rect' | 'ellipse' | 'blur' | 'pixelate';

export type Annotation =
  | { id: string; kind: BoxKind; style: Style; x: Px; y: Px; w: Px; h: Px }
  | { id: string; kind: 'line' | 'arrow'; style: Style; x1: Px; y1: Px; x2: Px; y2: Px }
  | { id: string; kind: 'pen' | 'highlighter'; style: Style; points: Px[] }
  | { id: string; kind: 'text'; style: Style; x: Px; y: Px; text: string }
  | { id: string; kind: 'step'; style: Style; x: Px; y: Px; n: number };

export const isRedaction = (a: Annotation): boolean => a.kind === 'blur' || a.kind === 'pixelate';

/** Areas whose content must not leak into the PDF's text layer or links. */
export function redactions(anns: readonly Annotation[]): Rect[] {
  return anns.filter(isRedaction).map(bounds);
}

/** Annotations up to this tall are kept whole by pagination, like an image. */
export const KEEP_WHOLE_MAX: Px = 300;

/**
 * Page breaks avoid cutting through small annotations (an arrow, a step marker, a note).
 * Tall frames and redactions may be cut: they still draw on both pages.
 */
export function annotationForbidden(anns: readonly Annotation[]): Forbidden[] {
  return anns
    .filter((a) => !isRedaction(a))
    .map(paintBounds)
    .filter((b) => b.height <= KEEP_WHOLE_MAX)
    .map((b) => ({ y0: b.y, y1: b.y + b.height, kind: 'atomic' as const }));
}

/** Widens an automatic side crop so annotations drawn in the margins stay on the page. */
export function cropAround(
  crop: { x0: Px; x1: Px; cropped: boolean },
  anns: readonly Annotation[],
  width: Px,
): { x0: Px; x1: Px; cropped: boolean } {
  if (!crop.cropped || !anns.length) return crop;
  let { x0, x1 } = crop;
  for (const a of anns) {
    const b = paintBounds(a);
    x0 = Math.min(x0, Math.max(0, b.x));
    x1 = Math.max(x1, Math.min(width, b.x + b.width));
  }
  return { x0, x1, cropped: x0 > 0 || x1 < width };
}

export function nextStepNumber(anns: readonly Annotation[]): number {
  return anns.reduce((n, a) => (a.kind === 'step' ? Math.max(n, a.n) : n), 0) + 1;
}

export const stepRadius = (s: Style): Px => Math.round(s.fontSize * 0.8);
export const lineHeight = (s: Style): Px => s.fontSize * 1.25;

/** Text width estimate for bounds/hit tests (the renderer measures for real). */
function textWidth(text: string, size: number): number {
  return Math.max(...text.split('\n').map((l) => l.length * size * 0.55), size);
}

export function bounds(a: Annotation): Rect {
  switch (a.kind) {
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixelate':
      return { x: a.x, y: a.y, width: a.w, height: a.h };
    case 'line':
    case 'arrow':
      return {
        x: Math.min(a.x1, a.x2),
        y: Math.min(a.y1, a.y2),
        width: Math.abs(a.x2 - a.x1),
        height: Math.abs(a.y2 - a.y1),
      };
    case 'pen':
    case 'highlighter': {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < a.points.length; i += 2) {
        x0 = Math.min(x0, a.points[i]!);
        x1 = Math.max(x1, a.points[i]!);
        y0 = Math.min(y0, a.points[i + 1]!);
        y1 = Math.max(y1, a.points[i + 1]!);
      }
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    case 'text': {
      const lines = a.text.split('\n').length;
      return {
        x: a.x,
        y: a.y,
        width: textWidth(a.text, a.style.fontSize),
        height: lines * lineHeight(a.style),
      };
    }
    case 'step': {
      const r = stepRadius(a.style);
      return { x: a.x - r, y: a.y - r, width: 2 * r, height: 2 * r };
    }
  }
}

/** Bounds grown by the stroke, so thick strokes at a page edge are drawn on both pages. */
export function paintBounds(a: Annotation): Rect {
  const b = bounds(a);
  const pad = a.kind === 'highlighter' ? highlighterWidth(a.style) : a.style.width * 3 + 2;
  return { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
}

export const highlighterWidth = (s: Style): Px => Math.max(12, s.width * 5);

function distToSegment(px: Px, py: Px, x1: Px, y1: Px, x2: Px, y2: Px): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Is document point (x, y) on the annotation (within `tol` px)? */
export function hitTest(a: Annotation, x: Px, y: Px, tol = 6): boolean {
  switch (a.kind) {
    case 'rect': {
      // Outline only, so a frame drawn around content doesn't block clicks inside it.
      const inside =
        x >= a.x - tol && x <= a.x + a.w + tol && y >= a.y - tol && y <= a.y + a.h + tol;
      const deep = x > a.x + tol && x < a.x + a.w - tol && y > a.y + tol && y < a.y + a.h - tol;
      return inside && !deep;
    }
    case 'blur':
    case 'pixelate':
      return x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;
    case 'ellipse': {
      const rx = a.w / 2 || 1;
      const ry = a.h / 2 || 1;
      const d = Math.hypot((x - a.x - rx) / rx, (y - a.y - ry) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= tol;
    }
    case 'line':
    case 'arrow':
      return distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= tol + a.style.width / 2;
    case 'pen':
    case 'highlighter': {
      const w = a.kind === 'highlighter' ? highlighterWidth(a.style) / 2 : a.style.width / 2;
      for (let i = 2; i < a.points.length; i += 2) {
        if (
          distToSegment(x, y, a.points[i - 2]!, a.points[i - 1]!, a.points[i]!, a.points[i + 1]!) <=
          tol + w
        ) {
          return true;
        }
      }
      return false;
    }
    case 'text':
    case 'step': {
      const b = bounds(a);
      return (
        x >= b.x - tol && x <= b.x + b.width + tol && y >= b.y - tol && y <= b.y + b.height + tol
      );
    }
  }
}

/** Topmost annotation under the point. */
export function annotationAt(anns: readonly Annotation[], x: Px, y: Px): Annotation | null {
  for (let i = anns.length - 1; i >= 0; i--) if (hitTest(anns[i]!, x, y)) return anns[i]!;
  return null;
}

export function moveBy(a: Annotation, dx: Px, dy: Px): Annotation {
  switch (a.kind) {
    case 'line':
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'pen':
    case 'highlighter':
      return { ...a, points: a.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    default:
      return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

/** Unlimited undo/redo over immutable snapshots (the annotations, plus the crop). */
export interface History<T = Annotation[]> {
  past: T[];
  present: T;
  future: T[];
}

export const emptyHistory = <T = Annotation[]>(present: T = [] as unknown as T): History<T> => ({
  past: [],
  present,
  future: [],
});

export function commit<T>(h: History<T>, next: T): History<T> {
  return { past: [...h.past, h.present], present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

/** The canvas calls the renderer needs (browser or @napi-rs/canvas contexts both fit). */
export interface AnnotationCtx {
  // `unknown` so both DOM and @napi-rs/canvas contexts (whose style types differ) fit.
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: unknown;
  lineJoin: unknown;
  globalAlpha: number;
  globalCompositeOperation: unknown;
  font: string;
  textBaseline: unknown;
  textAlign: unknown;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  stroke(): void;
  fill(): void;
  fillText(text: string, x: number, y: number): void;
}

/** Pixel effects need the page image under them; the caller supplies them in canvas px. */
export interface PixelEffects {
  blur(x: number, y: number, w: number, h: number): void;
  pixelate(x: number, y: number, w: number, h: number): void;
}

export const ANNOTATION_FONT = 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif';

/**
 * Draws annotations over a page image that shows document region `region` at `scale`
 * canvas px per CSS px. Redactions go first (they act on the content), then shapes.
 */
export function drawAnnotations(
  ctx: AnnotationCtx,
  anns: readonly Annotation[],
  region: { x0: Px; y0: Px; x1: Px; y1: Px },
  scale: number,
  effects?: PixelEffects,
): void {
  const visible = anns.filter((a) => {
    const b = paintBounds(a);
    return (
      b.x < region.x1 && b.x + b.width > region.x0 && b.y < region.y1 && b.y + b.height > region.y0
    );
  });
  for (const a of visible) {
    if (a.kind !== 'blur' && a.kind !== 'pixelate') continue;
    const x = (a.x - region.x0) * scale;
    const y = (a.y - region.y0) * scale;
    effects?.[a.kind](x, y, a.w * scale, a.h * scale);
  }
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-region.x0, -region.y0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of visible) drawOne(ctx, a);
  ctx.restore();
}

function drawOne(ctx: AnnotationCtx, a: Annotation): void {
  const s = a.style;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  switch (a.kind) {
    case 'rect':
      ctx.beginPath();
      ctx.rect(a.x, a.y, a.w, a.h);
      ctx.stroke();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        a.x + a.w / 2,
        a.y + a.h / 2,
        Math.abs(a.w / 2),
        Math.abs(a.h / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    case 'line':
    case 'arrow': {
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
      if (a.kind === 'arrow') {
        const len = Math.max(10, s.width * 4);
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        ctx.beginPath();
        ctx.moveTo(a.x2, a.y2);
        ctx.lineTo(a.x2 - len * Math.cos(ang - 0.45), a.y2 - len * Math.sin(ang - 0.45));
        ctx.lineTo(a.x2 - len * Math.cos(ang + 0.45), a.y2 - len * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'pen':
    case 'highlighter': {
      if (a.kind === 'highlighter') {
        ctx.globalAlpha = 0.35;
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineWidth = highlighterWidth(s);
      }
      ctx.beginPath();
      ctx.moveTo(a.points[0] ?? 0, a.points[1] ?? 0);
      for (let i = 2; i < a.points.length; i += 2) ctx.lineTo(a.points[i]!, a.points[i + 1]!);
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.font = `${s.fontSize}px ${ANNOTATION_FONT}`;
      ctx.textBaseline = 'top';
      a.text.split('\n').forEach((line, i) => ctx.fillText(line, a.x, a.y + i * lineHeight(s)));
      break;
    }
    case 'step': {
      const r = stepRadius(s);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(r * 1.1)}px ${ANNOTATION_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(a.n), a.x, a.y + 1);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
