import { repeatHeight, type Annotation, type FilterId, type PageSlice } from '@screenscroll/core';
import { ArrowDown, ArrowUp, EyeOff, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { t } from '@/shared/i18n';
import type { Analysis } from '@/studio/engine/analysis';
import { filterCanvas, paintAnnotations } from '@/studio/engine/compose';
import { isNaturalOrder, type PageSelection } from '@/studio/engine/plan';
import { drawFromStrip } from '../strip';

const W = 72;

const actionBtn =
  'grid h-5 w-5 place-items-center rounded text-neutral-600 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-700';

/** Left rail (UI §3): thumbnails in display order with reversible exclude and reorder controls. */
export function Thumbnails(p: {
  analysis: Analysis;
  rawSlices: PageSlice[];
  selection: PageSelection;
  page: number;
  onSelect: (activeIndex: number) => void;
  onToggleExclude: (origIndex: number) => void;
  onMove: (pos: number, dir: -1 | 1) => void;
  onIncludeAll: () => void;
  onResetOrder: () => void;
  annotations: Annotation[];
  filter: FilterId;
}) {
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const excludedCount = p.selection.excludedSet.size;
  const naturalOrder = isNaturalOrder(p.selection.orderedIndices);
  const activePosByOrig = new Map<number, number>();
  p.selection.activeIndices.forEach((origIdx, activePos) => activePosByOrig.set(origIdx, activePos));

  useEffect(() => {
    const activeOrig = p.selection.activeIndices[p.page];
    if (activeOrig === undefined) return;
    const pos = p.selection.orderedIndices.indexOf(activeOrig);
    if (pos >= 0) itemRefs.current[pos]?.scrollIntoView({ block: 'nearest' });
  }, [p.page, p.selection.activeIndices, p.selection.orderedIndices]);

  return (
    <nav
      aria-label={t('Pages')}
      className="flex w-32 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    >
      {(excludedCount > 0 || !naturalOrder) && (
        <div
          data-testid="page-tools-bar"
          className="flex flex-col gap-1 border-b border-neutral-200 px-2 py-1.5 text-[11px] dark:border-neutral-800"
        >
          {excludedCount > 0 && (
            <span className="text-neutral-500">{t('{n} excluded', { n: excludedCount })}</span>
          )}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {excludedCount > 0 && (
              <button
                type="button"
                onClick={p.onIncludeAll}
                className="text-left text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {t('Include all')}
              </button>
            )}
            {!naturalOrder && (
              <button
                type="button"
                onClick={p.onResetOrder}
                className="text-left text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {t('Reset order')}
              </button>
            )}
          </div>
        </div>
      )}
      <ol className="flex-1 space-y-2 overflow-y-auto p-2">
        {p.selection.orderedIndices.map((origIdx, pos) => {
          const s = p.rawSlices[origIdx]!;
          const excluded = p.selection.excludedSet.has(origIdx);
          const activePos = activePosByOrig.get(origIdx) ?? -1;
          const isCurrent = !excluded && activePos === p.page;
          const onlyActive = !excluded && p.selection.activeIndices.length <= 1;
          return (
            <li
              key={`${s.y0}-${s.y1}-${origIdx}`}
              ref={(el) => {
                itemRefs.current[pos] = el;
              }}
              data-testid={`thumb-item-${origIdx}`}
              data-excluded={excluded ? 'true' : 'false'}
              className={`group rounded-md p-1 ${isCurrent ? 'bg-neutral-200 dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/70'}`}
            >
              <button
                type="button"
                disabled={excluded}
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={
                  excluded ? t('Page {n} (excluded)', { n: origIdx + 1 }) : `Page ${activePos + 1}`
                }
                onClick={() => {
                  if (!excluded && activePos >= 0) p.onSelect(activePos);
                }}
                className={`flex w-full items-start gap-1.5 rounded text-left focus-visible:outline-2 focus-visible:outline-accent ${excluded ? 'cursor-default opacity-45' : ''}`}
              >
                <span
                  className={`w-4 shrink-0 text-right text-[12px] text-neutral-500 ${excluded ? 'line-through' : ''}`}
                >
                  {excluded ? origIdx + 1 : activePos + 1}
                </span>
                <div className="min-w-0">
                  <Thumb
                    analysis={p.analysis}
                    slice={s}
                    annotations={p.annotations}
                    filter={p.filter}
                  />
                  {excluded && (
                    <span className="mt-0.5 block text-[10px] text-neutral-500">
                      {t('Excluded')}
                    </span>
                  )}
                </div>
              </button>
              <div
                className={`mt-1 flex items-center justify-end gap-0.5 transition-opacity ${excluded ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}
              >
                <button
                  type="button"
                  disabled={pos === 0}
                  aria-label={t('Move page up')}
                  title={t('Move page up')}
                  onClick={() => p.onMove(pos, -1)}
                  className={actionBtn}
                >
                  <ArrowUp aria-hidden size={12} />
                </button>
                <button
                  type="button"
                  disabled={pos === p.selection.orderedIndices.length - 1}
                  aria-label={t('Move page down')}
                  title={t('Move page down')}
                  onClick={() => p.onMove(pos, 1)}
                  className={actionBtn}
                >
                  <ArrowDown aria-hidden size={12} />
                </button>
                <button
                  type="button"
                  disabled={onlyActive}
                  aria-label={excluded ? t('Include page') : t('Exclude page')}
                  title={
                    excluded
                      ? t('Include page')
                      : onlyActive
                        ? t('At least one page must stay included')
                        : t('Exclude page')
                  }
                  onClick={() => p.onToggleExclude(origIdx)}
                  className={actionBtn}
                >
                  {excluded ? (
                    <RotateCcw aria-hidden size={12} />
                  ) : (
                    <EyeOff aria-hidden size={12} />
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Thumb({
  analysis,
  slice,
  annotations,
  filter,
}: {
  analysis: Analysis;
  slice: PageSlice;
  annotations: Annotation[];
  filter: FilterId;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const k = W / (slice.x1 - slice.x0);
    const head = repeatHeight(slice) * k;
    const h = Math.max(1, Math.round((slice.y1 - slice.y0) * k + head));
    c.width = W;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, h);
    // A repeated table header first, as on the page.
    if (slice.repeat) drawFromStrip(ctx, analysis, { ...slice, ...slice.repeat }, W);
    ctx.save();
    ctx.translate(0, head);
    drawFromStrip(ctx, analysis, slice, W);
    ctx.restore();
    filterCanvas(ctx, filter, k);
    ctx.save();
    ctx.translate(0, head);
    paintAnnotations(ctx, annotations, slice, k);
    ctx.restore();
  }, [analysis, slice, annotations, filter]);
  return (
    <canvas
      ref={ref}
      className="border border-neutral-200 dark:border-neutral-700"
      style={{ width: W }}
    />
  );
}
