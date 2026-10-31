import {
  findSensitive,
  matchRect,
  type PageSlice,
  type Rect,
  type SensitiveKind,
  type TextRun,
} from '@screenscroll/core';
import { useMemo, useState } from 'react';
import { t } from '@/shared/i18n';

const KIND: Record<SensitiveKind, string> = {
  email: 'Email',
  phone: 'Phone',
  card: 'Card',
  id: 'ID number',
};

const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;

/** Text widths in a common sans-serif at the run's size: the page's font isn't known here. */
function measurer(px: number) {
  return (t: string) => {
    ctx.font = `${px}px Arial, Helvetica, sans-serif`;
    return ctx.measureText(t).width;
  };
}

/**
 * Mark up → Personal data (auto-redact): emails, phone, card and ID numbers found in the
 * page's own text, each with its page; the ticked ones become blur marks, which also take
 * the text out of the PDF.
 */
export function RedactCard(p: {
  runs: readonly TextRun[];
  slices: readonly PageSlice[];
  /** Blur marks already on the capture: matches under one count as done. */
  covered: readonly Rect[];
  onBlur: (rects: Rect[]) => void;
}) {
  const found = useMemo(
    () =>
      findSensitive(p.runs).map((m) => {
        const run = p.runs[m.run]!;
        const rect = matchRect(run, m, measurer(run.fontSizePx));
        const cy = rect.y + rect.height / 2;
        const page = p.slices.findIndex((s) => cy >= s.y0 && cy < s.y1) + 1;
        return { ...m, rect, page };
      }),
    [p.runs, p.slices],
  );
  const open = found.filter(
    (f) =>
      !p.covered.some(
        (c) =>
          c.x <= f.rect.x + 1 &&
          c.y <= f.rect.y + 1 &&
          c.x + c.width >= f.rect.x + f.rect.width - 1 &&
          c.y + c.height >= f.rect.y + f.rect.height - 1,
      ),
  );
  const [off, setOff] = useState<Set<string>>(new Set());
  const key = (f: (typeof found)[number]) => `${f.run}:${f.start}`;
  const chosen = open.filter((f) => !off.has(key(f)));

  return (
    <section className="mb-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-700" data-testid="redact">
      <h2 className="font-semibold">Personal data</h2>
      {!found.length ? (
        <p className="text-[12px] text-neutral-500">
          {t('No emails, phone, card or ID numbers in the page text.')}
        </p>
      ) : !open.length ? (
        <p className="text-[12px] text-neutral-500">All {found.length} found are blurred.</p>
      ) : (
        <>
          <p className="pb-1 text-[12px] text-neutral-500">
            {t('Found in the page text. Ticked ones are blurred and removed from the PDF.')}
          </p>
          <ul className="max-h-48 overflow-y-auto">
            {open.map((f) => (
              <li key={key(f)}>
                <label className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={!off.has(key(f))}
                    onChange={(e) => {
                      const next = new Set(off);
                      if (e.target.checked) next.delete(key(f));
                      else next.add(key(f));
                      setOff(next);
                    }}
                    className="accent-[#0e7c7b]"
                  />
                  <span className="w-16 shrink-0 text-neutral-500">{KIND[f.kind]}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.text}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">
                    {f.page ? `p. ${f.page}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!chosen.length}
            onClick={() => {
              p.onBlur(chosen.map((f) => f.rect));
              setOff(new Set());
            }}
            className="mt-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Blur {chosen.length} selected
          </button>
        </>
      )}
    </section>
  );
}
