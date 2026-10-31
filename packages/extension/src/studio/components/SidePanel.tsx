import {
  ArrowLeftRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { t } from '@/shared/i18n';

export interface PanelPrefs {
  side: 'left' | 'right';
  width: number;
  open: boolean;
}
export const DEFAULT_PANEL: PanelPrefs = { side: 'right', width: 272, open: true };
const MIN = 220;
const MAX = 520;

/**
 * The Studio's side panel: drag its inner edge to resize, move it to the other side, or
 * fold it away for more room. Arrow keys on the edge resize it too.
 */
export function SidePanel(p: {
  prefs: PanelPrefs;
  onPrefs: (p: PanelPrefs) => void;
  label: string;
  children: ReactNode;
}) {
  const { side, width, open } = p.prefs;
  const start = useRef<{ x: number; w: number } | null>(null);
  const set = (patch: Partial<PanelPrefs>) => p.onPrefs({ ...p.prefs, ...patch });
  const clamp = (w: number) => Math.max(MIN, Math.min(MAX, Math.round(w)));
  const Open = side === 'right' ? PanelRightOpen : PanelLeftOpen;
  const Close = side === 'right' ? PanelRightClose : PanelLeftClose;
  const edge = side === 'right' ? 'border-l' : 'border-r';

  if (!open)
    return (
      <div
        className={`flex shrink-0 flex-col items-center ${edge} border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900`}
      >
        <button
          type="button"
          aria-label={`Show ${p.label}`}
          title={`Show ${p.label}`}
          onClick={() => set({ open: true })}
          className="rounded p-1.5 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Open aria-hidden size={17} />
        </button>
      </div>
    );

  return (
    <div
      className={`relative flex shrink-0 flex-col ${edge} border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900`}
      style={{ width }}
      data-testid="side-panel"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${p.label}`}
        aria-valuenow={width}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        tabIndex={0}
        className={`absolute top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none ${side === 'right' ? '-left-1' : '-right-1'}`}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          start.current = { x: e.clientX, w: width };
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const dx = e.clientX - start.current.x;
          set({ width: clamp(start.current.w + (side === 'right' ? -dx : dx)) });
        }}
        onPointerUp={() => (start.current = null)}
        onKeyDown={(e) => {
          const grow = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
          const shrink = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
          if (e.key === grow) set({ width: clamp(width + 16) });
          else if (e.key === shrink) set({ width: clamp(width - 16) });
        }}
      />
      <div className="flex items-center justify-end gap-0.5 border-b border-neutral-200 px-1 py-0.5 dark:border-neutral-800">
        <button
          type="button"
          aria-label={`Move ${p.label} to the ${side === 'right' ? 'left' : 'right'}`}
          title={`Move to the ${side === 'right' ? 'left' : 'right'}`}
          onClick={() => set({ side: side === 'right' ? 'left' : 'right' })}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
        >
          <ArrowLeftRight aria-hidden size={15} />
        </button>
        <button
          type="button"
          aria-label={`Hide ${p.label}`}
          title={t('Hide')}
          onClick={() => set({ open: false })}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
        >
          <Close aria-hidden size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{p.children}</div>
    </div>
  );
}
