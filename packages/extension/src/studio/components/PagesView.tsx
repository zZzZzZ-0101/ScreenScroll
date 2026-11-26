import {
  repeatHeight,
  watermarkOn,
  type Annotation,
  type FilterId,
  type PageLayout,
  type PageSlice,
  type Rect,
  type Watermark,
} from '@screenscroll/core';
import { useEffect, useRef, useState } from 'react';
import type { Analysis } from '@/studio/engine/analysis';
import { composePage, filterCanvas, paintAnnotations } from '@/studio/engine/compose';
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
  watermark: Watermark;
  filter: FilterId;
  /** Reports the scale shown (share of actual size), for the zoom control's label. */
  onEffective: (scale: number) => void;
  /** Active search/redaction match to scroll to and highlight. */
  highlight?: { rect: Rect; seq: number } | null;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const highlightEl = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  const fromScroll = useRef(false);
  const programmaticUntil = useRef(0);
  const visibleHeights = useRef<Map<number, number>>(new Map());
  const latestPage = useRef(p.page);
  latestPage.current = p.page;
  const latestOnSelect = useRef(p.onSelect);
  latestOnSelect.current = p.onSelect;

  useEffect(() => {
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    programmaticUntil.current = performance.now() + 600;
    refs.current[p.page]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.page]);

  useEffect(() => {
    if (!p.highlight) return;
    const cy = p.highlight.rect.y + p.highlight.rect.height / 2;
    const idx = p.slices.findIndex((s) => cy >= s.y0 && cy < s.y1);
    if (idx >= 0 && idx !== latestPage.current) {
      programmaticUntil.current = performance.now() + 600;
      latestOnSelect.current(idx);
    }
    requestAnimationFrame(() => {
      if (highlightEl.current) {
        programmaticUntil.current = performance.now() + 600;
        highlightEl.current.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } else if (idx >= 0) {
        refs.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }, [p.highlight, p.slices]);

  // Manual user scroll cancels any programmatic scroll suppression right away.
  useEffect(() => {
    const el = scroller.current!;
    const clearSuppression = () => {
      programmaticUntil.current = 0;
    };
    el.addEventListener('wheel', clearSuppression, { passive: true });
    el.addEventListener('pointerdown', clearSuppression, { passive: true });
    return () => {
      el.removeEventListener('wheel', clearSuppression);
      el.removeEventListener('pointerdown', clearSuppression);
    };
  }, []);

  // Scroll-spy: highlight the most visible page in Thumbnails as the user scrolls.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    refs.current.length = p.slices.length;
    visibleHeights.current.clear();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const raw = (entry.target as HTMLElement).dataset.pageIndex;
          const idx = raw !== undefined ? Number(raw) : -1;
          if (idx >= 0) {
            visibleHeights.current.set(idx, entry.isIntersecting ? entry.intersectionRect.height : 0);
          }
        }
        if (performance.now() < programmaticUntil.current) return;
        let bestIdx: number | null = null;
        let bestHeight = 0;
        for (const [idx, h] of visibleHeights.current) {
          if (h > bestHeight) {
            bestHeight = h;
            bestIdx = idx;
          }
        }
        if (bestIdx !== null && bestIdx !== latestPage.current) {
          fromScroll.current = true;
          latestOnSelect.current(bestIdx);
        }
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (let i = 0; i < p.slices.length; i++) {
      const node = refs.current[i];
      if (node) io.observe(node);
    }
    return () => io.disconnect();
  }, [p.slices]);

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

  const k = pageW / p.layout.paperW;
  const cssScale = p.layout.s * k;
  const hlRect = p.highlight?.rect ?? null;
  const hlCy = hlRect ? hlRect.y + hlRect.height / 2 : -1;

  return (
    <div
      ref={scroller}
      className="flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950"
      style={{ padding: PAD }}
      data-testid="pages-view"
    >
      <div className="mx-auto flex w-fit flex-col items-center gap-6">
        {p.slices.map((s, i) => {
          const hasHighlight = hlRect !== null && hlCy >= s.y0 && hlCy < s.y1;
          return (
            <div
              key={`${s.y0}-${s.y1}`}
              data-page-index={i}
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
                filter={p.filter}
                pageW={pageW}
              />
              {hasHighlight && hlRect && (
                <div
                  ref={highlightEl}
                  data-testid="search-highlight"
                  aria-hidden
                  className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-300/30 ring-2 ring-amber-400/50"
                  style={{
                    left: p.layout.box.x * k + (hlRect.x - s.x0) * cssScale,
                    top: p.layout.box.y * k + (repeatHeight(s) + (hlRect.y - s.y0)) * cssScale,
                    width: Math.max(8, hlRect.width * cssScale),
                    height: Math.max(8, hlRect.height * cssScale),
                  }}
                />
              )}
              <span className="absolute bottom-1 right-2 text-[11px] text-neutral-400">{i + 1}</span>
              {watermarkOn(p.watermark, i + 1, p.slices.length) && (
                <span
                  aria-hidden
                  data-testid="watermark-preview"
                  className="pointer-events-none absolute top-1/2 left-1/2 font-[Helvetica,Arial,sans-serif] whitespace-nowrap"
                  style={{
                    color: p.watermark.color,
                    opacity: p.watermark.opacity,
                    fontSize: p.watermark.sizePt * (pageW / p.layout.paperW),
                    transform: `translate(-50%, -50%) rotate(${-p.watermark.angle}deg)`,
                  }}
                >
                  {p.watermark.text}
                </span>
              )}
            </div>
          );
        })}
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
  filter,
  pageW,
}: {
  session: LoadedSession;
  frames: FrameCache;
  analysis: Analysis;
  slice: PageSlice;
  layout: PageLayout;
  annotations: Annotation[];
  filter: FilterId;
  pageW: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const k = pageW / layout.paperW; // preview px per pt
  const w = (slice.x1 - slice.x0) * layout.s * k;
  const h = (slice.y1 - slice.y0 + repeatHeight(slice)) * layout.s * k;
  useEffect(() => {
    const c = ref.current!;
    const ratio = devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(w * ratio));
    c.height = Math.max(1, Math.round(h * ratio));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    // Quick, blurry first paint from the thumbnail strip (a repeated header first)...
    const pxPerCss = c.width / (slice.x1 - slice.x0);
    const head = repeatHeight(slice) * pxPerCss;
    if (slice.repeat) drawFromStrip(ctx, analysis, { ...slice, ...slice.repeat }, c.width);
    ctx.save();
    ctx.translate(0, head);
    drawFromStrip(ctx, analysis, slice, c.width);
    ctx.restore();
    filterCanvas(ctx, filter, pxPerCss);
    ctx.save();
    ctx.translate(0, head);
    paintAnnotations(ctx, annotations, slice, pxPerCss);
    ctx.restore();
    // ...then the real pixels once the page is on screen, at the preview's own size.
    let cancelled = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const scale = Math.min(1, c.width / ((slice.x1 - slice.x0) * session.dpr));
        const img = await composePage(session, frames, slice, scale, annotations, filter);
        if (!cancelled) ctx.drawImage(img, 0, 0, c.width, c.height);
      },
      { rootMargin: '400px' },
    );
    io.observe(c);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [session, frames, analysis, slice, w, h, annotations, filter]);
  return (
    <canvas
      ref={ref}
      className="absolute"
      style={{ left: layout.box.x * k, top: layout.box.y * k, width: w, height: h }}
    />
  );
}
