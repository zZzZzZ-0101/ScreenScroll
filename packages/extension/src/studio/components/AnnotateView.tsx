import {
  watermarkOn,
  type FilterId,
  type PageSlice,
  type Watermark,
  annotationAt,
  bounds,
  highlighterWidth,
  lineHeight,
  moveBy,
  moveEndpoint,
  moveRegion,
  nextStepNumber,
  normalizeRegion,
  paintBounds,
  resizeAnnotation,
  resizeRegion,
  stepRadius,
  ANNOTATION_FONT,
  type Annotation,
  type Rect,
  type Region,
  type ResizeHandle,
  type Style,
  type Tool,
} from '@screenscroll/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/shared/i18n';
import { composePage } from '@/studio/engine/compose';
import { stepZoom, type Zoom } from './ZoomControl';
import type { FrameCache, LoadedSession } from '@/studio/engine/session';

/** Document CSS px per tile: small canvases, rendered only when on screen. */
const TILE = 1024;
const PAD = 24;
/** Below this size a drag is treated as a click (and makes no shape). */
const MIN_DRAG = 3;

interface Props {
  session: LoadedSession;
  frames: FrameCache;
  annotations: Annotation[];
  crop: Region | null;
  tool: Tool;
  style: Style;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Replaces the annotation list as one undo step. */
  onAnnotations: (next: Annotation[]) => void;
  onCrop: (crop: Region | null) => void;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  onEffective: (scale: number) => void;
  /** Mark up → Page: shown live as they are chosen, as the PDF will have them. */
  filter: FilterId;
  watermark: Watermark;
  /** The PDF pages, for where each watermark goes. */
  slices: PageSlice[];
  /** pt per CSS px of the PDF layout. */
  scale: number;
  /** Active search/redaction match to scroll to and highlight. */
  highlight?: { rect: Rect; seq: number } | null;
}

type Draft =
  | { kind: 'shape'; ann: Annotation; x0: number; y0: number }
  | { kind: 'move'; id: string; ann: Annotation; x0: number; y0: number }
  | {
      kind: 'resize';
      id: string;
      handle: ResizeHandle;
      orig: Annotation;
      ann: Annotation;
      x0: number;
      y0: number;
    }
  | { kind: 'endpoint'; id: string; end: 'start' | 'end'; orig: Annotation; ann: Annotation }
  | { kind: 'crop'; x0: number; y0: number; x1: number; y1: number }
  | {
      kind: 'crop-resize';
      handle: ResizeHandle;
      orig: Region;
      region: Region;
      x0: number;
      y0: number;
    }
  | { kind: 'crop-move'; orig: Region; region: Region; x0: number; y0: number };

const HANDLES: ReadonlyArray<[ResizeHandle, number, number, string, () => string]> = [
  ['nw', 0, 0, 'nwse-resize', () => t('Resize top left')],
  ['n', 0.5, 0, 'ns-resize', () => t('Resize top')],
  ['ne', 1, 0, 'nesw-resize', () => t('Resize top right')],
  ['e', 1, 0.5, 'ew-resize', () => t('Resize right')],
  ['se', 1, 1, 'nwse-resize', () => t('Resize bottom right')],
  ['s', 0.5, 1, 'ns-resize', () => t('Resize bottom')],
  ['sw', 0, 1, 'nesw-resize', () => t('Resize bottom left')],
  ['w', 0, 0.5, 'ew-resize', () => t('Resize left')],
];

const isResizableBox = (a: Annotation): boolean =>
  a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'blur' || a.kind === 'pixelate';

const isLineOrArrow = (
  a: Annotation,
): a is Extract<Annotation, { kind: 'line' | 'arrow' }> => a.kind === 'line' || a.kind === 'arrow';

const uid = () => crypto.randomUUID();

/**
 * Annotate view (UI §3): the whole capture at fit-to-width, with annotations drawn in
 * document coordinates. The tiles show what export will produce (annotations flattened by
 * the same renderer); the SVG layer shows only what is being drawn or dragged right now.
 */
export function AnnotateView(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(800);
  const committing = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{
    id: string | null;
    x: number;
    y: number;
    text: string;
  } | null>(null);

  useEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - 2 * PAD));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Screen px per CSS px: fit the width (never enlarging), or the zoom chosen.
  const fit = Math.min(1, Math.max(0.1, avail / p.session.width));
  const z =
    typeof p.zoom === 'number'
      ? p.zoom
      : p.zoom === 'width'
        ? Math.max(0.1, avail / p.session.width)
        : fit;
  const { onEffective } = p;
  useEffect(() => onEffective(z), [z, onEffective]);
  const latest = useRef({ z, onZoom: p.onZoom });
  latest.current = { z, onZoom: p.onZoom };
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      latest.current.onZoom(stepZoom(latest.current.z, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const W = p.session.width;
  const H = p.session.height;

  useEffect(() => {
    if (!p.highlight || !scroller.current) return;
    const el = scroller.current;
    const r = p.highlight.rect;
    const targetTop = Math.max(0, PAD + (r.y + r.height / 2) * z - el.clientHeight / 2);
    const targetLeft = Math.max(0, PAD + (r.x + r.width / 2) * z - el.clientWidth / 2);
    el.scrollTo({ top: targetTop, left: targetLeft, behavior: 'smooth' });
  }, [p.highlight, z]);

  // The annotation being dragged is drawn live in SVG, so leave it out of the tiles.
  const hidden =
    draft?.kind === 'move' || draft?.kind === 'resize' || draft?.kind === 'endpoint'
      ? draft.id
      : (editing?.id ?? null);
  const flattened = useMemo(
    () => p.annotations.filter((a) => a.id !== hidden),
    [p.annotations, hidden],
  );

  // Pressing Escape cancels an active drag without committing or discarding selection.
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && draftRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setDraft(null);
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = body.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, (e.clientX - r.left) / z)),
      y: Math.max(0, Math.min(H, (e.clientY - r.top) / z)),
    };
  };

  const commitText = () => {
    if (!editing || committing.current) return;
    committing.current = true;
    queueMicrotask(() => (committing.current = false));
    const text = editing.text.replace(/\s+$/, '');
    const others = p.annotations.filter((a) => a.id !== editing.id);
    const old = p.annotations.find((a) => a.id === editing.id);
    setEditing(null);
    if (!text) {
      if (old) p.onAnnotations(others);
      return;
    }
    const ann: Annotation =
      old && old.kind === 'text'
        ? { ...old, text }
        : { id: uid(), kind: 'text', style: p.style, x: editing.x, y: editing.y, text };
    if (old && old.kind === 'text' && old.text === text) return;
    p.onAnnotations(old ? p.annotations.map((a) => (a.id === ann.id ? ann : a)) : [...others, ann]);
    p.onSelect(ann.id);
  };

  // Leaving Mark up (or the Studio) with the text box open keeps what was typed.
  const flush = useRef(commitText);
  flush.current = commitText;
  useEffect(() => () => flush.current(), []);

  const startResize = (e: React.PointerEvent, ann: Annotation, handle: ResizeHandle) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    const { x, y } = point(e);
    body.current?.setPointerCapture(e.pointerId);
    setDraft({ kind: 'resize', id: ann.id, handle, orig: ann, ann, x0: x, y0: y });
  };

  const startEndpoint = (e: React.PointerEvent, ann: Annotation, end: 'start' | 'end') => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    body.current?.setPointerCapture(e.pointerId);
    setDraft({ kind: 'endpoint', id: ann.id, end, orig: ann, ann });
  };

  const startCropResize = (e: React.PointerEvent, region: Region, handle: ResizeHandle) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    const { x, y } = point(e);
    body.current?.setPointerCapture(e.pointerId);
    setDraft({ kind: 'crop-resize', handle, orig: region, region, x0: x, y0: y });
  };

  const startCropMove = (e: React.PointerEvent, region: Region) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    const { x, y } = point(e);
    body.current?.setPointerCapture(e.pointerId);
    setDraft({ kind: 'crop-move', orig: region, region, x0: x, y0: y });
  };

  const insideCrop = (x: number, y: number, r: Region | null): r is Region =>
    !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // The click blurs the text box, which commits it.
    if (editing) return;
    const { x, y } = point(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const s = p.style;
    switch (p.tool) {
      case 'select': {
        const hit = annotationAt(p.annotations, x, y);
        p.onSelect(hit?.id ?? null);
        if (hit) setDraft({ kind: 'move', id: hit.id, ann: hit, x0: x, y0: y });
        else if (insideCrop(x, y, p.crop))
          setDraft({ kind: 'crop-move', orig: p.crop, region: p.crop, x0: x, y0: y });
        return;
      }
      case 'crop':
        if (insideCrop(x, y, p.crop))
          setDraft({ kind: 'crop-move', orig: p.crop, region: p.crop, x0: x, y0: y });
        else setDraft({ kind: 'crop', x0: x, y0: y, x1: x, y1: y });
        return;
      case 'text':
        // Keep this click's mousedown from blurring the box it opens.
        e.preventDefault();
        setEditing({ id: null, x, y: y - lineHeight(s) / 2, text: '' });
        return;
      case 'step': {
        const ann: Annotation = {
          id: uid(),
          kind: 'step',
          style: s,
          x,
          y,
          n: nextStepNumber(p.annotations),
        };
        p.onAnnotations([...p.annotations, ann]);
        p.onSelect(ann.id);
        return;
      }
      case 'pen':
      case 'highlighter':
        setDraft({
          kind: 'shape',
          x0: x,
          y0: y,
          ann: { id: uid(), kind: p.tool, style: s, points: [x, y] },
        });
        return;
      case 'line':
      case 'arrow':
        setDraft({
          kind: 'shape',
          x0: x,
          y0: y,
          ann: { id: uid(), kind: p.tool, style: s, x1: x, y1: y, x2: x, y2: y },
        });
        return;
      default:
        setDraft({
          kind: 'shape',
          x0: x,
          y0: y,
          ann: { id: uid(), kind: p.tool, style: s, x, y, w: 0, h: 0 },
        });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const { x, y } = point(e);
    const docBounds = { width: W, height: H };
    if (draft.kind === 'crop') {
      setDraft({ ...draft, x1: x, y1: y });
      return;
    }
    if (draft.kind === 'crop-resize') {
      setDraft({
        ...draft,
        region: resizeRegion(draft.orig, draft.handle, x - draft.x0, y - draft.y0, docBounds),
      });
      return;
    }
    if (draft.kind === 'crop-move') {
      setDraft({
        ...draft,
        region: moveRegion(draft.orig, x - draft.x0, y - draft.y0, docBounds),
      });
      return;
    }
    if (draft.kind === 'resize') {
      setDraft({
        ...draft,
        ann: resizeAnnotation(draft.orig, draft.handle, x - draft.x0, y - draft.y0, docBounds),
      });
      return;
    }
    if (draft.kind === 'endpoint') {
      setDraft({
        ...draft,
        ann: moveEndpoint(draft.orig, draft.end, x, y, docBounds),
      });
      return;
    }
    if (draft.kind === 'move') {
      const orig = p.annotations.find((a) => a.id === draft.id);
      if (orig) setDraft({ ...draft, ann: moveBy(orig, x - draft.x0, y - draft.y0) });
      return;
    }
    const a = draft.ann;
    let next: Annotation;
    switch (a.kind) {
      case 'pen':
      case 'highlighter': {
        const lx = a.points.at(-2)!;
        const ly = a.points.at(-1)!;
        if (Math.hypot(x - lx, y - ly) < 1.5) return;
        next = { ...a, points: [...a.points, x, y] };
        break;
      }
      case 'line':
      case 'arrow':
        next = { ...a, x2: x, y2: y };
        break;
      case 'rect':
      case 'ellipse':
      case 'blur':
      case 'pixelate':
        next = {
          ...a,
          x: Math.min(draft.x0, x),
          y: Math.min(draft.y0, y),
          w: Math.abs(x - draft.x0),
          h: Math.abs(y - draft.y0),
        };
        break;
      default:
        return;
    }
    setDraft({ ...draft, ann: next });
  };

  const onUp = () => {
    if (!draft) return;
    setDraft(null);
    if (draft.kind === 'crop') {
      const r = normalizeRegion({ x: draft.x0, y: draft.y0 }, { x: draft.x1, y: draft.y1 }, W, H);
      if (r.x1 - r.x0 >= 20 && r.y1 - r.y0 >= 20) p.onCrop(r);
      return;
    }
    if (draft.kind === 'crop-resize' || draft.kind === 'crop-move') {
      const { orig, region } = draft;
      if (
        region.x0 !== orig.x0 ||
        region.x1 !== orig.x1 ||
        region.y0 !== orig.y0 ||
        region.y1 !== orig.y1
      ) {
        p.onCrop(region);
      }
      return;
    }
    if (draft.kind === 'resize') {
      const b0 = bounds(draft.orig);
      const b1 = bounds(draft.ann);
      if (b0.x !== b1.x || b0.y !== b1.y || b0.width !== b1.width || b0.height !== b1.height) {
        p.onAnnotations(p.annotations.map((a) => (a.id === draft.id ? draft.ann : a)));
      }
      return;
    }
    if (draft.kind === 'endpoint') {
      if (
        isLineOrArrow(draft.orig) &&
        isLineOrArrow(draft.ann) &&
        (draft.orig.x1 !== draft.ann.x1 ||
          draft.orig.y1 !== draft.ann.y1 ||
          draft.orig.x2 !== draft.ann.x2 ||
          draft.orig.y2 !== draft.ann.y2)
      ) {
        p.onAnnotations(p.annotations.map((a) => (a.id === draft.id ? draft.ann : a)));
      }
      return;
    }
    if (draft.kind === 'move') {
      const moved = draft.ann;
      const orig = p.annotations.find((a) => a.id === draft.id);
      const b0 = orig && bounds(orig);
      const b1 = bounds(moved);
      if (b0 && (b0.x !== b1.x || b0.y !== b1.y))
        p.onAnnotations(p.annotations.map((a) => (a.id === draft.id ? moved : a)));
      return;
    }
    const b = bounds(draft.ann);
    if (Math.max(b.width, b.height) < MIN_DRAG) return;
    p.onAnnotations([...p.annotations, draft.ann]);
    p.onSelect(draft.ann.id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (p.tool !== 'select') return;
    const { x, y } = point(e);
    const hit = annotationAt(p.annotations, x, y);
    if (hit?.kind === 'text') setEditing({ id: hit.id, x: hit.x, y: hit.y, text: hit.text });
  };

  const live =
    draft &&
    (draft.kind === 'shape' ||
      draft.kind === 'move' ||
      draft.kind === 'resize' ||
      draft.kind === 'endpoint')
      ? draft.ann
      : null;
  const sel = p.annotations.find((a) => a.id === p.selected) ?? null;
  const activeSel =
    sel &&
    draft &&
    (draft.kind === 'move' || draft.kind === 'resize' || draft.kind === 'endpoint') &&
    draft.id === sel.id
      ? draft.ann
      : sel;
  const selBox = activeSel ? bounds(activeSel) : null;
  const cropBox =
    draft?.kind === 'crop'
      ? normalizeRegion({ x: draft.x0, y: draft.y0 }, { x: draft.x1, y: draft.y1 }, W, H)
      : draft?.kind === 'crop-resize' || draft?.kind === 'crop-move'
        ? draft.region
        : p.crop;
  const editStyle =
    (editing?.id && p.annotations.find((a) => a.id === editing.id)?.style) || p.style;
  const handleSize = 10 / z;
  const showCropHandles =
    !!cropBox && !editing && draft?.kind !== 'crop' && (p.tool === 'crop' || p.tool === 'select');

  const tiles = [];
  for (let y0 = 0; y0 < H; y0 += TILE) tiles.push({ y0, y1: Math.min(H, y0 + TILE) });

  return (
    <div
      ref={scroller}
      className="flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950"
      style={{ padding: PAD }}
      data-testid="annotate-view"
    >
      <div
        ref={body}
        data-testid="annotate-body"
        className="relative mx-auto bg-white shadow-sm"
        style={{
          width: W * z,
          height: H * z,
          cursor: p.tool === 'select' ? 'default' : p.tool === 'text' ? 'text' : 'crosshair',
          touchAction: 'none',
        }}
        onPointerDown={onDown}
        // The click that opens a text box must not move focus away from it again.
        onMouseDown={(e) => {
          if (p.tool === 'text' || editing) e.preventDefault();
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDraft(null)}
        onDoubleClick={onDoubleClick}
      >
        {tiles.map((t) => (
          <Tile
            key={t.y0}
            session={p.session}
            frames={p.frames}
            y0={t.y0}
            y1={t.y1}
            z={z}
            annotations={flattened}
            filter={p.filter}
          />
        ))}
        {p.watermark.text.trim() &&
          p.slices.map((sl, i) =>
            watermarkOn(p.watermark, i + 1, p.slices.length) ? (
              <span
                key={`${sl.y0}-${sl.y1}`}
                aria-hidden
                data-testid="watermark-preview"
                className="pointer-events-none absolute font-[Helvetica,Arial,sans-serif] whitespace-nowrap"
                style={{
                  left: ((sl.x0 + sl.x1) / 2) * z,
                  top: ((sl.y0 + sl.y1) / 2) * z,
                  color: p.watermark.color,
                  opacity: p.watermark.opacity,
                  // pt on paper → CSS px of the capture → screen px.
                  fontSize: (p.watermark.sizePt / p.scale) * z,
                  transform: `translate(-50%, -50%) rotate(${-p.watermark.angle}deg)`,
                }}
              >
                {p.watermark.text}
              </span>
            ) : null,
          )}
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={W * z}
          height={H * z}
          viewBox={`0 0 ${W} ${H}`}
        >
          {cropBox && (
            <path
              data-testid="crop-shade"
              d={`M0 0H${W}V${H}H0Z M${cropBox.x0} ${cropBox.y0}V${cropBox.y1}H${cropBox.x1}V${cropBox.y0}Z`}
              fill="rgba(0,0,0,0.4)"
              fillRule="evenodd"
            />
          )}
          {cropBox && (
            <rect
              data-testid="crop-box"
              x={cropBox.x0}
              y={cropBox.y0}
              width={cropBox.x1 - cropBox.x0}
              height={cropBox.y1 - cropBox.y0}
              fill={p.tool === 'crop' && !editing ? 'transparent' : 'none'}
              stroke="#0e7c7b"
              strokeWidth={2 / z}
              strokeDasharray={`${6 / z} ${4 / z}`}
              className={p.tool === 'crop' && !editing ? 'pointer-events-auto' : undefined}
              style={p.tool === 'crop' && !editing ? { cursor: 'move' } : undefined}
              onPointerDown={
                p.tool === 'crop' && !editing ? (e) => startCropMove(e, cropBox) : undefined
              }
            />
          )}
          {showCropHandles &&
            cropBox &&
            HANDLES.map(([h, fx, fy, cursor, label]) => (
              <rect
                key={`crop-${h}`}
                data-crop-handle={h}
                data-testid={`crop-handle-${h}`}
                aria-label={label()}
                x={cropBox.x0 + fx * (cropBox.x1 - cropBox.x0) - handleSize / 2}
                y={cropBox.y0 + fy * (cropBox.y1 - cropBox.y0) - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={2 / z}
                fill="#ffffff"
                stroke="#0e7c7b"
                strokeWidth={1.5 / z}
                className="pointer-events-auto"
                style={{ cursor }}
                onPointerDown={(e) => startCropResize(e, cropBox, h)}
              />
            ))}
          {live && <SvgAnnotation a={live} />}
          {selBox && !editing && (
            <rect
              data-testid="selection"
              x={selBox.x - 4 / z}
              y={selBox.y - 4 / z}
              width={selBox.width + 8 / z}
              height={selBox.height + 8 / z}
              fill="none"
              stroke="#0e7c7b"
              strokeWidth={1.5 / z}
              strokeDasharray={`${4 / z} ${3 / z}`}
            />
          )}
          {activeSel &&
            selBox &&
            !editing &&
            p.tool === 'select' &&
            isResizableBox(activeSel) &&
            HANDLES.map(([h, fx, fy, cursor, label]) => (
              <rect
                key={h}
                data-handle={h}
                data-testid={`handle-${h}`}
                aria-label={label()}
                x={selBox.x + fx * selBox.width - handleSize / 2}
                y={selBox.y + fy * selBox.height - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={2 / z}
                fill="#ffffff"
                stroke="#0e7c7b"
                strokeWidth={1.5 / z}
                className="pointer-events-auto"
                style={{ cursor }}
                onPointerDown={(e) => startResize(e, activeSel, h)}
              />
            ))}
          {activeSel && !editing && p.tool === 'select' && isLineOrArrow(activeSel) && (
            <>
              <circle
                data-endpoint="start"
                data-testid="endpoint-start"
                aria-label={t('Move start point')}
                cx={activeSel.x1}
                cy={activeSel.y1}
                r={5.5 / z}
                fill="#ffffff"
                stroke="#0e7c7b"
                strokeWidth={1.5 / z}
                className="pointer-events-auto"
                style={{ cursor: 'move' }}
                onPointerDown={(e) => startEndpoint(e, activeSel, 'start')}
              />
              <circle
                data-endpoint="end"
                data-testid="endpoint-end"
                aria-label={t('Move end point')}
                cx={activeSel.x2}
                cy={activeSel.y2}
                r={5.5 / z}
                fill="#ffffff"
                stroke="#0e7c7b"
                strokeWidth={1.5 / z}
                className="pointer-events-auto"
                style={{ cursor: 'move' }}
                onPointerDown={(e) => startEndpoint(e, activeSel, 'end')}
              />
            </>
          )}
          {p.highlight && (
            <rect
              data-testid="search-highlight"
              x={p.highlight.rect.x - 2 / z}
              y={p.highlight.rect.y - 2 / z}
              width={Math.max(8 / z, p.highlight.rect.width + 4 / z)}
              height={Math.max(8 / z, p.highlight.rect.height + 4 / z)}
              rx={3 / z}
              fill="rgba(251, 191, 36, 0.28)"
              stroke="#d97706"
              strokeWidth={2 / z}
            />
          )}
        </svg>
        {editing && (
          <textarea
            ref={(el) => {
              // Focus now, not on the next frame: keys typed right after the click must land
              // here, not trigger tool shortcuts.
              if (el && document.activeElement !== el) el.focus();
            }}
            aria-label="Annotation text"
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setEditing(null);
              else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitText();
              }
            }}
            onBlur={commitText}
            className="absolute resize-none overflow-hidden border border-dashed border-accent bg-transparent p-0 outline-none"
            style={{
              left: editing.x * z,
              top: editing.y * z,
              color: editStyle.color,
              font: `${editStyle.fontSize * z}px ${ANNOTATION_FONT}`,
              lineHeight: `${lineHeight(editStyle) * z}px`,
              minWidth: 120,
              width: Math.max(120, longestLine(editing.text) * editStyle.fontSize * 0.6 * z + 16),
              height: Math.max(1, editing.text.split('\n').length) * lineHeight(editStyle) * z + 4,
            }}
          />
        )}
      </div>
    </div>
  );
}

const longestLine = (t: string) => Math.max(1, ...t.split('\n').map((l) => l.length));

/** One fit-to-width slice of the capture with the committed annotations flattened in. */
function Tile(p: {
  session: LoadedSession;
  frames: FrameCache;
  y0: number;
  y1: number;
  z: number;
  annotations: Annotation[];
  filter: FilterId;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const W = p.session.width;
  // Only annotations reaching into this tile; a change elsewhere doesn't repaint it.
  const mine = p.annotations.filter((a) => {
    const b = paintBounds(a);
    return b.y < p.y1 && b.y + b.height > p.y0;
  });
  const key = JSON.stringify(mine);

  useEffect(() => {
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), {
      rootMargin: '600px',
    });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const ratio = devicePixelRatio || 1;
    const scale = Math.min(1, (p.z * ratio) / p.session.dpr);
    const region = { x0: 0, x1: W, y0: p.y0, y1: p.y1 };
    void composePage(
      p.session,
      p.frames,
      region,
      scale,
      JSON.parse(key) as Annotation[],
      p.filter,
    ).then(
      (img) => {
        const c = ref.current;
        if (cancelled || !c) return;
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible, key, p.session, p.frames, p.y0, p.y1, p.z, W, p.filter]);

  return (
    <canvas
      ref={ref}
      className="absolute left-0"
      style={{ top: p.y0 * p.z, width: W * p.z, height: (p.y1 - p.y0) * p.z }}
    />
  );
}

/** Live preview of the shape being drawn or moved, in document units. */
function SvgAnnotation({ a }: { a: Annotation }) {
  const s = a.style;
  const stroke = {
    stroke: s.color,
    strokeWidth: s.width,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  switch (a.kind) {
    case 'rect':
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} {...stroke} />;
    case 'ellipse':
      return (
        <ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} {...stroke} />
      );
    case 'cover':
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.style.color} />;
    case 'blur':
    case 'pixelate':
      return (
        <rect
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          fill="rgba(120,120,120,0.35)"
          stroke="#555"
          strokeDasharray="6 4"
        />
      );
    case 'line':
    case 'arrow': {
      const len = Math.max(10, s.width * 4);
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      return (
        <g>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} {...stroke} />
          {a.kind === 'arrow' && (
            <polygon
              fill={s.color}
              points={[
                [a.x2, a.y2],
                [a.x2 - len * Math.cos(ang - 0.45), a.y2 - len * Math.sin(ang - 0.45)],
                [a.x2 - len * Math.cos(ang + 0.45), a.y2 - len * Math.sin(ang + 0.45)],
              ]
                .map((pt) => pt.join(','))
                .join(' ')}
            />
          )}
        </g>
      );
    }
    case 'pen':
    case 'highlighter': {
      const pts: string[] = [];
      for (let i = 0; i < a.points.length; i += 2) pts.push(`${a.points[i]},${a.points[i + 1]}`);
      return a.kind === 'pen' ? (
        <polyline points={pts.join(' ')} {...stroke} />
      ) : (
        <polyline
          points={pts.join(' ')}
          {...stroke}
          strokeWidth={highlighterWidth(s)}
          opacity={0.35}
          style={{ mixBlendMode: 'multiply' }}
        />
      );
    }
    case 'text':
      return (
        <text
          x={a.x}
          y={a.y}
          fill={s.color}
          fontSize={s.fontSize}
          fontFamily={ANNOTATION_FONT}
          dominantBaseline="hanging"
        >
          {a.text.split('\n').map((line, i) => (
            <tspan key={i} x={a.x} dy={i ? lineHeight(s) : 0}>
              {line}
            </tspan>
          ))}
        </text>
      );
    case 'step': {
      const r = stepRadius(s);
      return (
        <g>
          <circle cx={a.x} cy={a.y} r={r} fill={s.color} />
          <text
            x={a.x}
            y={a.y + 1}
            fill="#fff"
            fontSize={Math.round(r * 1.1)}
            fontWeight="bold"
            fontFamily={ANNOTATION_FONT}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {a.n}
          </text>
        </g>
      );
    }
  }
}
