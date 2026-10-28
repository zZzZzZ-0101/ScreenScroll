import { Minus, Plus } from 'lucide-react';

/** 'page' fits a whole page, 'width' fits the width; a number is a share of actual size. */
export type Zoom = 'page' | 'width' | number;

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** The next zoom step from what is shown now (a fit mode shows some effective scale). */
export function stepZoom(effective: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((s) => s > effective + 0.005) ?? STEPS.at(-1)!;
  return [...STEPS].reverse().find((s) => s < effective - 0.005) ?? STEPS[0]!;
}

const btn =
  'grid h-7 w-7 place-items-center rounded hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 dark:hover:bg-neutral-800';

/** PDF-viewer style zoom: −, current value with presets, +. Ctrl+wheel and + − 0 also work. */
export function ZoomControl(p: {
  zoom: Zoom;
  effective: number;
  onZoom: (z: Zoom) => void;
  /** Mark up has no page to fit. */
  pageFit?: boolean;
}) {
  const label = `${Math.round(p.effective * 100)}%`;
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white/95 p-0.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/95"
    >
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out (−)"
        disabled={p.effective <= 0.25}
        onClick={() => p.onZoom(stepZoom(p.effective, -1))}
        className={btn}
      >
        <Minus aria-hidden size={15} />
      </button>
      <select
        aria-label="Zoom level"
        value={typeof p.zoom === 'number' ? String(p.zoom) : p.zoom}
        onChange={(e) => {
          const v = e.target.value;
          p.onZoom(v === 'page' || v === 'width' ? v : Number(v));
        }}
        className="h-7 rounded bg-transparent px-1 text-center tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
      >
        {p.pageFit !== false && <option value="page">Fit page</option>}
        <option value="width">Fit width</option>
        {typeof p.zoom !== 'number' && <option disabled>{label}</option>}
        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
          <option key={z} value={String(z)}>
            {Math.round(z * 100)}%
          </option>
        ))}
        {typeof p.zoom === 'number' && ![0.5, 0.75, 1, 1.25, 1.5, 2, 3].includes(p.zoom) && (
          <option value={String(p.zoom)}>{label}</option>
        )}
      </select>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in (+)"
        disabled={p.effective >= 4}
        onClick={() => p.onZoom(stepZoom(p.effective, 1))}
        className={btn}
      >
        <Plus aria-hidden size={15} />
      </button>
    </div>
  );
}
