import type { BreakKind, PaginationDebug } from './paginate.js';

/** The subset of CanvasRenderingContext2D the overlay needs (browser or @napi-rs/canvas). */
export interface Ctx2D {
  // `unknown` so both DOM and @napi-rs/canvas contexts (whose style types differ) fit.
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
}

/** Break colours shared with the Studio (UI §3): section green, paragraph teal, line amber. */
export const KIND_COLOURS: Record<BreakKind, string> = {
  section: '#1e8e3e',
  paragraph: '#0e7c7b',
  listItem: '#0e7c7b',
  tableRow: '#6a4fb3',
  line: '#d68a00',
  pixel: '#5f6368',
  forced: '#d93025',
  manual: '#1a73e8',
  end: '#202124',
};

/**
 * PAGINATION §9 debug overlay, drawn over a long thumbnail of the capture already painted
 * on `ctx`: forbidden runs (red tint), opaque regions (blue tint), candidates (ticks by
 * kind), chosen breaks (thick lines; forced ones dashed). `scale` = thumbnail px per CSS px.
 */
export function drawDebugOverlay(
  ctx: Ctx2D,
  d: PaginationDebug,
  width: number,
  scale: number,
): void {
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(217, 48, 37, 0.18)';
  for (const f of d.forbidden)
    ctx.fillRect(0, f.y0 * scale, width, Math.max(1, (f.y1 - f.y0) * scale));
  ctx.fillStyle = 'rgba(26, 115, 232, 0.12)';
  for (const o of d.opaque) ctx.fillRect(0, o.y0 * scale, width, (o.y1 - o.y0) * scale);
  ctx.lineWidth = 1;
  for (const c of d.candidates) {
    ctx.strokeStyle = KIND_COLOURS[c.kind];
    const len = c.forced ? 6 : 14;
    ctx.beginPath();
    ctx.moveTo(0, c.y * scale);
    ctx.lineTo(len, c.y * scale);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  for (const s of d.slices.slice(0, -1)) {
    ctx.strokeStyle = KIND_COLOURS[s.breakKind];
    ctx.setLineDash(s.breakKind === 'forced' ? [8, 6] : []);
    ctx.beginPath();
    ctx.moveTo(0, s.y1 * scale);
    ctx.lineTo(width, s.y1 * scale);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** JSON companion to the overlay: the slices plus a summary. */
export function debugJson(d: PaginationDebug): string {
  return JSON.stringify(
    {
      pages: d.slices.length,
      slices: d.slices,
      candidates: d.candidates.length,
      forbidden: d.forbidden.length,
      opaque: d.opaque.length,
    },
    null,
    2,
  );
}
