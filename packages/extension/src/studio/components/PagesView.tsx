import type { Annotation, PageLayout, PageSlice } from '@screenscroll/core';
import { useEffect, useRef, useState } from 'react';
import type { Analysis } from '@/studio/engine/analysis';
import { composePage, paintAnnotations } from '@/studio/engine/compose';
import type { FrameCache, LoadedSession } from '@/studio/engine/session';
import { drawFromStrip } from '../strip';

import { stepZoom, type Zoom } from './ZoomControl';

/** CSS px per pt at 100% (96 dpi screen, 72 pt per inch): actual size. */
const PX_PER_PT = 96 / 72;
const PAD = 24;

/** Pages view (UI §3): true page shapes with margins, as they will be exported. */
export function PagesView(p: {
  session: LoadedSession;
  frames: FrameCache;
  analysis: Analysis;
  slices: PageSlice[];
  layout: PageLayout;
  page: number;
  onSelect: (i: number) => void;
  annotations: Annotation[];
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  /** Reports the scale shown (share of actual size), for the zoom control's label. */
  onEffective: (scale: number) => void;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  useEffect(() => {
    refs.current[p.page]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.page]);
  useEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() =>
      setAvail({ w: el.clientWidth - 2 * PAD, h: el.clientHeight - 2 * PAD }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const actual = p.layout.paperW * PX_PER_PT;
  const ratio = p.layout.paperH / p.layout.paperW;
  const pageW =
    p.zoom === 'width'
      ? Math.max(120, avail.w)
      : p.zoom === 'page'
        ? Math.max(120, Math.min(avail.w, avail.h / ratio))
        : actual * p.zoom;
  const effective = pageW / actual;
  const { onEffective } = p;
  useEffect(() => onEffective(effective), [effective, onEffective]);

  // Ctrl+wheel zooms like a PDF viewer (a passive listener can't stop the browser's own zoom).
  const latest = useRef({ effective, onZoom: p.onZoom });
  latest.current = { effective, onZoom: p.onZoom };
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      latest.current.onZoom(stepZoom(latest.current.effective, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={scroller}
      className="flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950"
      style={{ padding: PAD }}
      data-testid="pages-view"
    >
      <div className="mx-auto flex w-fit flex-col items-center gap-6">
        {p.slices.map((s, i) => (
          <div
            key={`${s.y0}-${s.y1}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => p.onSelect(i)}
            className={`relative bg-white shadow-sm ring-1 ${i === p.page ? 'ring-accent ring-2' : 'ring-neutral-300 dark:ring-neutral-700'}`}
            style={{ width: pageW, height: pageW * ratio }}
          >
            <PageCanvas
              session={p.session}
              frames={p.frames}
              analysis={p.analysis}
              slice={s}
              layout={p.layout}
              annotations={p.annotations}
              pageW={pageW}
            />
            <span className="absolute bottom-1 right-2 text-[11px] text-neutral-400">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageCanvas({
  session,
  frames,
  analysis,
  slice,
  layout,
  annotations,
  pageW,
}: {
  session: LoadedSession;
  frames: FrameCache;
  analysis: Analysis;
  slice: PageSlice;
  layout: PageLayout;
  annotations: Annotation[];
  pageW: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const k = pageW / layout.paperW; // preview px per pt
  const w = (slice.x1 - slice.x0) * layout.s * k;
  const h = (slice.y1 - slice.y0) * layout.s * k;
  useEffect(() => {
    const c = ref.current!;
    const ratio = devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(w * ratio));
    c.height = Math.max(1, Math.round(h * ratio));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    // Quick, blurry first paint from the thumbnail strip...
    drawFromStrip(ctx, analysis, slice, c.width);
    paintAnnotations(ctx, annotations, slice, c.width / (slice.x1 - slice.x0));
    // ...then the real pixels once the page is on screen, at the preview's own size.
    let cancelled = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const scale = Math.min(1, c.width / ((slice.x1 - slice.x0) * session.dpr));
        const img = await composePage(session, frames, slice, scale, annotations);
        if (!cancelled) ctx.drawImage(img, 0, 0, c.width, c.height);
      },
      { rootMargin: '400px' },
    );
    io.observe(c);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [session, frames, analysis, slice, w, h, annotations]);
  return (
    <canvas
      ref={ref}
      className="absolute"
      style={{ left: layout.box.x * k, top: layout.box.y * k, width: w, height: h }}
    />
  );
}
