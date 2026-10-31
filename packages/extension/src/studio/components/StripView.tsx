import {
  gridSheets,
  KIND_COLOURS,
  type BreakCheck,
  type BreakKind,
  type PaginationDebug,
  type SheetGrid,
} from '@screenscroll/core';
import { Pin } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis } from '@/studio/engine/analysis';
import { composePage } from '@/studio/engine/compose';
import type { FrameCache, LoadedSession } from '@/studio/engine/session';
import type { Edits } from '../App';
import { t } from '@/shared/i18n';

/** Plain-language names for the break kinds (colours stay as the visual cue). */
const KIND_TITLES: Record<BreakKind, string> = {
  section: 'Break between sections',
  paragraph: 'Break between paragraphs',
  listItem: 'Break between list items',
  tableRow: 'Break between table rows',
  line: 'Break between lines of text',
  pixel: 'Break in an empty gap',
  manual: 'Break you placed',
  forced: 'Break through a tall image (repeated at the top of the next page)',
  end: 'End',
};

/** CSS zoom applied to the ≤ 320 px thumbnail strip. */
const ZOOM = 1.5;
/** Breaks snap to a candidate within this many CSS px unless Alt is held (UI §3). */
const SNAP = 12;
const MAG_W = 640;
const MAG_HALF = 40;

interface Props {
  session: LoadedSession;
  frames: FrameCache;
  analysis: Analysis;
  debug: PaginationDebug;
  crop: { x0: number; x1: number };
  edits: Edits;
  onEdits: (e: Edits) => void;
  page: number;
  /** Breaks follow a document's own pages: shown, not editable. */
  locked?: boolean;
  /** Breaks worth a look get a marker. */
  checks?: BreakCheck[];
  /** Document pages: drawn over the strip with edges to drag (the page grid follows). */
  sheetGrid?: { grid: SheetGrid; onGrid: (g: SheetGrid) => void };
}

export function StripView(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const k = p.analysis.stripScale * ZOOM; // display px per CSS px
  const width = (p.crop.x1 - p.crop.x0) * k;
  const breaks = p.debug.slices.slice(0, -1).map((s) => ({
    y: s.y1,
    kind: s.breakKind,
    pinned: s.breakKind === 'manual',
  }));
  const [drag, setDrag] = useState<{ index: number; y: number } | null>(null);
  const [focusY, setFocusY] = useState<number | null>(null);

  useEffect(() => {
    const s = p.debug.slices[p.page];
    if (s && scroller.current) scroller.current.scrollTo({ top: s.y0 * k, behavior: 'smooth' });
  }, [p.page, p.debug.slices, k]);

  const docY = useCallback(
    (clientY: number) => {
      const top = body.current!.getBoundingClientRect().top;
      return Math.max(0, Math.min(p.session.height, (clientY - top) / k));
    },
    [k, p.session.height],
  );

  const snap = useCallback(
    (y: number, free: boolean) => {
      if (free) return y;
      let best = y;
      let dist = SNAP;
      for (const c of p.debug.candidates) {
        const d = Math.abs(c.y - y);
        if (d < dist && !c.forced) {
          dist = d;
          best = c.y;
        }
      }
      return best;
    },
    [p.debug.candidates],
  );

  const move = (from: { y: number; pinned: boolean }, to: number) => {
    const pinned = p.edits.pinned.filter((y) => Math.abs(y - from.y) > 0.5);
    const removed = from.pinned ? p.edits.removed : [...p.edits.removed, from.y];
    p.onEdits({ pinned: [...pinned, to], removed });
  };
  const remove = (b: { y: number; pinned: boolean }) => {
    if (b.pinned)
      p.onEdits({ ...p.edits, pinned: p.edits.pinned.filter((y) => Math.abs(y - b.y) > 0.5) });
    else p.onEdits({ ...p.edits, removed: [...p.edits.removed, b.y] });
  };

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto bg-neutral-100 p-6 dark:bg-neutral-950"
        data-testid="strip-view"
      >
        <div
          ref={body}
          data-testid="strip-body"
          className="relative mx-auto bg-white shadow-sm"
          style={{ width, height: p.session.height * k }}
          onDoubleClick={(e) => {
            if (p.locked) return;
            const y = snap(docY(e.clientY), e.altKey);
            p.onEdits({ ...p.edits, pinned: [...p.edits.pinned, y] });
          }}
        >
          {p.analysis.strip.map((part) => (
            <StripPart
              key={part.y0}
              canvas={part.canvas}
              top={part.y0 * k}
              height={(part.y1 - part.y0) * k}
              offsetX={-p.crop.x0 * k}
              fullWidth={p.session.width * k}
            />
          ))}
          {p.sheetGrid && (
            <SheetOverlay
              {...p.sheetGrid}
              k={k}
              cropX0={p.crop.x0}
              height={p.session.height}
              docY={docY}
              onFocus={setFocusY}
            />
          )}
          {!p.sheetGrid && breaks.map((b, i) => {
            const y = drag?.index === i ? drag.y : b.y;
            const colour = KIND_COLOURS[b.kind];
            return (
              <div
                key={`${b.y}-${i}`}
                className={`group absolute left-0 right-0 -mt-[6px] h-3 ${p.locked ? '' : 'cursor-ns-resize'}`}
                style={{ top: y * k }}
                onPointerDown={(e) => {
                  if (p.locked || (e.target as HTMLElement).closest('button')) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDrag({ index: i, y: b.y });
                  setFocusY(b.y);
                }}
                onPointerMove={(e) => {
                  if (drag?.index !== i) return;
                  const ny = snap(docY(e.clientY), e.altKey);
                  setDrag({ index: i, y: ny });
                  setFocusY(ny);
                }}
                onPointerUp={() => {
                  if (drag?.index === i && Math.abs(drag.y - b.y) > 0.5) move(b, drag.y);
                  setDrag(null);
                }}
                onPointerEnter={() => !drag && setFocusY(b.y)}
                onPointerLeave={() => !drag && setFocusY(null)}
                data-testid="break"
                title={KIND_TITLES[b.kind]}
              >
                <div
                  className="absolute left-0 right-0 top-[5px]"
                  style={{
                    borderTop: `${b.kind === 'forced' ? '2px dashed' : '2px solid'} ${colour}`,
                  }}
                />
                {p.checks?.some((c) => c.index === i) && (
                  <span
                    role="img"
                    aria-label={t('Needs a look')}
                    title={p.checks.find((c) => c.index === i)!.reason}
                    data-testid="break-check"
                    className="absolute -left-6 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white"
                  >
                    !
                  </span>
                )}
                {b.pinned && (
                  <Pin
                    aria-label={t('Pinned break')}
                    role="img"
                    size={13}
                    className="absolute -left-5 -top-0.5"
                    style={{ color: colour }}
                  />
                )}
                {!p.locked && (
                  <button
                    type="button"
                    aria-label={`Remove break ${i + 1}`}
                    onClick={() => remove(b)}
                    className="absolute -right-7 -top-1 hidden h-5 w-5 rounded-full bg-neutral-800 text-[11px] text-white group-hover:block focus-visible:block focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {focusY !== null && (
        <Magnifier session={p.session} frames={p.frames} crop={p.crop} y={focusY} />
      )}
    </div>
  );
}

function StripPart(p: {
  canvas: HTMLCanvasElement;
  top: number;
  height: number;
  offsetX: number;
  fullWidth: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    const c = p.canvas;
    c.style.width = `${p.fullWidth}px`;
    c.style.height = `${p.height}px`;
    c.style.marginLeft = `${p.offsetX}px`;
    c.style.display = 'block';
    host.append(c);
    return () => c.remove();
  }, [p.canvas, p.height, p.offsetX, p.fullWidth]);
  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 overflow-hidden"
      style={{ top: p.top, height: p.height }}
    />
  );
}

/** Full-resolution view of the rows around a break (UI §3 "live magnifier"). */
function Magnifier(p: {
  session: LoadedSession;
  frames: FrameCache;
  crop: { x0: number; x1: number };
  y: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pending = useRef(0);
  useEffect(() => {
    const id = ++pending.current;
    const region = {
      x0: p.crop.x0,
      x1: p.crop.x1,
      y0: Math.max(0, p.y - MAG_HALF),
      y1: Math.min(p.session.height, p.y + MAG_HALF),
    };
    const scale = (MAG_W * (devicePixelRatio || 1)) / ((region.x1 - region.x0) * p.session.dpr);
    const frame = requestAnimationFrame(async () => {
      const img = await composePage(p.session, p.frames, region, Math.min(1, scale));
      if (id !== pending.current || !ref.current) return;
      const c = ref.current;
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const cutY = ((p.y - region.y0) / (region.y1 - region.y0)) * c.height;
      ctx.fillStyle = 'rgba(217, 48, 37, 0.85)';
      ctx.fillRect(0, Math.round(cutY), c.width, Math.max(1, Math.round(devicePixelRatio || 1)));
    });
    return () => cancelAnimationFrame(frame);
  }, [p.session, p.frames, p.crop.x0, p.crop.x1, p.y]);
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-neutral-300 bg-white p-1 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <canvas
        ref={ref}
        style={{ width: MAG_W }}
        aria-label={t('Magnified view of the break')}
        role="img"
      />
    </div>
  );
}

type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * M8 "drag the pages": the document pages over the strip. Dragging a page's top edge moves
 * the first page (page 1) or sets the gap (any later page); its bottom edge sets the page
 * height; the side edges set the column. The grid redraws as you drag and is saved once,
 * on release, so Undo takes back a whole drag.
 */
function SheetOverlay(p: {
  grid: SheetGrid;
  onGrid: (g: SheetGrid) => void;
  k: number;
  cropX0: number;
  height: number;
  docY: (clientY: number) => number;
  onFocus: (y: number | null) => void;
}) {
  const [draft, setDraft] = useState<SheetGrid | null>(null);
  const [drag, setDrag] = useState<{ edge: Edge; page: number } | null>(null);
  const g = draft ?? p.grid;
  const layout = gridSheets(g, p.height);
  if (!layout) return null;
  const xOf = (clientX: number, host: HTMLElement) => {
    const r = host.closest('[data-testid="strip-body"]')!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / p.k + p.cropX0);
  };
  const apply = (edge: Edge, page: number, e: React.PointerEvent<HTMLElement>): SheetGrid => {
    const y = Math.round(p.docY(e.clientY));
    if (edge === 'left') return { ...g, x0: Math.min(Math.round(xOf(e.clientX, e.currentTarget)), g.x1 - 20) };
    if (edge === 'right') return { ...g, x1: Math.max(Math.round(xOf(e.clientX, e.currentTarget)), g.x0 + 20) };
    if (edge === 'top')
      return page === 0
        ? { ...g, top: Math.max(0, y) }
        : { ...g, gap: Math.max(0, Math.round((y - g.top - page * g.height) / page)) };
    return { ...g, height: Math.max(20, Math.round((y - g.top - page * g.gap) / (page + 1))) };
  };
  const handle = (edge: Edge, page: number, style: React.CSSProperties, cursor: string) => (
    <div
      key={`${edge}-${page}`}
      role="slider"
      aria-label={`Page ${page + 1} ${edge} edge`}
      aria-valuenow={Math.round(edge === 'left' ? g.x0 : edge === 'right' ? g.x1 : edge === 'top' ? layout.sheets[page]!.y0 : layout.sheets[page]!.y1)}
      data-testid={`sheet-edge-${edge}-${page}`}
      className={`absolute z-10 ${cursor} hover:bg-accent/30`}
      style={style}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ edge, page });
        setDraft(g);
      }}
      onPointerMove={(e) => {
        if (drag?.edge !== edge || drag.page !== page) return;
        const next = apply(edge, page, e);
        setDraft(next);
        if (edge === 'top' || edge === 'bottom') p.onFocus(Math.round(p.docY(e.clientY)));
      }}
      onPointerUp={() => {
        if (draft) p.onGrid(draft);
        setDraft(null);
        setDrag(null);
        p.onFocus(null);
      }}
    />
  );
  return (
    <>
      {layout.sheets.map((s, i) => {
        const left = (g.x0 - p.cropX0) * p.k;
        const width = (g.x1 - g.x0) * p.k;
        const top = s.y0 * p.k;
        const h = (s.y1 - s.y0) * p.k;
        return (
          <div key={i} data-testid="sheet-outline">
            <div
              className="pointer-events-none absolute border-2 border-accent/80"
              style={{ left, top, width, height: h }}
            >
              <span className="absolute -top-0.5 left-1 rounded-b bg-accent px-1 text-[10px] text-white">
                {i + 1}
              </span>
            </div>
            {handle('top', i, { left, top: top - 4, width, height: 8 }, 'cursor-ns-resize')}
            {handle('bottom', i, { left, top: top + h - 4, width, height: 8 }, 'cursor-ns-resize')}
            {i === 0 && handle('left', i, { left: left - 4, top, width: 8, height: h }, 'cursor-ew-resize')}
            {i === 0 && handle('right', i, { left: left + width - 4, top, width: 8, height: h }, 'cursor-ew-resize')}
          </div>
        );
      })}
    </>
  );
}

