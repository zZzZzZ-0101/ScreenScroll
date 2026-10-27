import type { PageSlice } from '@scrollpress/core';
import { useEffect, useRef } from 'react';
import type { Analysis } from '@/lib/studio/analysis';
import { drawFromStrip } from './strip';

const W = 72;

/** Left rail (UI §3): one thumbnail per page; click to jump there. */
export function Thumbnails(p: {
  analysis: Analysis;
  slices: PageSlice[];
  page: number;
  onSelect: (i: number) => void;
}) {
  return (
    <nav
      aria-label="Pages"
      className="w-28 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <ol className="space-y-2">
        {p.slices.map((s, i) => (
          <li key={`${s.y0}-${s.y1}`}>
            <button
              type="button"
              aria-current={i === p.page ? 'page' : undefined}
              aria-label={`Page ${i + 1}`}
              onClick={() => p.onSelect(i)}
              className={`flex w-full items-start gap-1.5 rounded-md p-1 focus-visible:outline-2 focus-visible:outline-accent ${i === p.page ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
            >
              <span className="w-4 text-right text-neutral-500">{i + 1}</span>
              <Thumb analysis={p.analysis} slice={s} />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Thumb({ analysis, slice }: { analysis: Analysis; slice: PageSlice }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const h = Math.max(1, Math.round((W * (slice.y1 - slice.y0)) / (slice.x1 - slice.x0)));
    c.width = W;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, h);
    drawFromStrip(ctx, analysis, slice, W);
  }, [analysis, slice]);
  return (
    <canvas
      ref={ref}
      className="border border-neutral-200 dark:border-neutral-700"
      style={{ width: W }}
    />
  );
}
