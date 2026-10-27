import type { PageLayout, PageSlice } from '@scrollpress/core';
import { useEffect, useRef } from 'react';
import type { Analysis } from '@/lib/studio/analysis';
import { composePage } from '@/lib/studio/compose';
import type { FrameCache, LoadedSession } from '@/lib/studio/session';
import { drawFromStrip } from './strip';

const PAGE_W = 420;

/** Pages view (UI §3): true page shapes with margins, as they will be exported. */
export function PagesView(p: {
  session: LoadedSession;
  frames: FrameCache;
  analysis: Analysis;
  slices: PageSlice[];
  layout: PageLayout;
  page: number;
  onSelect: (i: number) => void;
}) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    refs.current[p.page]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.page]);
  return (
    <div
      className="flex-1 overflow-y-auto bg-neutral-100 p-6 dark:bg-neutral-950"
      data-testid="pages-view"
    >
      <div className="mx-auto flex flex-col items-center gap-6">
        {p.slices.map((s, i) => (
          <div
            key={`${s.y0}-${s.y1}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => p.onSelect(i)}
            className={`relative bg-white shadow-sm ring-1 ${i === p.page ? 'ring-accent ring-2' : 'ring-neutral-300 dark:ring-neutral-700'}`}
            style={{ width: PAGE_W, height: (PAGE_W * p.layout.paperH) / p.layout.paperW }}
          >
            <PageCanvas
              session={p.session}
              frames={p.frames}
              analysis={p.analysis}
              slice={s}
              layout={p.layout}
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
}: {
  session: LoadedSession;
  frames: FrameCache;
  analysis: Analysis;
  slice: PageSlice;
  layout: PageLayout;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const k = PAGE_W / layout.paperW; // preview px per pt
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
    // ...then the real pixels once the page is on screen, at the preview's own size.
    let cancelled = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const scale = Math.min(1, c.width / ((slice.x1 - slice.x0) * session.dpr));
        const img = await composePage(session, frames, slice, scale);
        if (!cancelled) ctx.drawImage(img, 0, 0, c.width, c.height);
      },
      { rootMargin: '400px' },
    );
    io.observe(c);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [session, frames, analysis, slice, w, h]);
  return (
    <canvas
      ref={ref}
      className="absolute"
      style={{ left: layout.box.x * k, top: layout.box.y * k, width: w, height: h }}
    />
  );
}
