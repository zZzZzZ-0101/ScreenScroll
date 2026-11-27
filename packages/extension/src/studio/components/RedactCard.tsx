import {
  findSensitive,
  findTextMatches,
  matchRect,
  type PageSlice,
  type Rect,
  type SensitiveKind,
  type TextRun,
} from '@screenscroll/core';
import { useMemo, useState } from 'react';
import { t } from '@/shared/i18n';

export type RedactKind = 'blur' | 'pixelate';

const KIND: Record<SensitiveKind, string> = {
  email: 'Email',
  phone: 'Phone',
  card: 'Card',
  id: 'ID number',
};

const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;

/** Text widths in a common sans-serif at the run's size: the page's font isn't known here. */
function measurer(px: number) {
  return (text: string) => {
    ctx.font = `${px}px Arial, Helvetica, sans-serif`;
    return ctx.measureText(text).width;
  };
}

function isCovered(rect: Rect, covered: readonly Rect[]): boolean {
  return covered.some(
    (c) =>
      c.x <= rect.x + 1 &&
      c.y <= rect.y + 1 &&
      c.x + c.width >= rect.x + rect.width - 1 &&
      c.y + c.height >= rect.y + rect.height - 1,
  );
}

/**
 * Mark up → Personal data (auto-redact) & Find text to hide: emails, phone, card and ID
 * numbers plus any user search term found in the page's DOM/OCR text, each with its page;
 * redacting adds blur or mosaic marks, which also take the text out of the PDF.
 */
export function RedactCard(p: {
  runs: readonly TextRun[];
  slices: readonly PageSlice[];
  /** Redaction marks already on the capture: matches under one count as done. */
  covered: readonly Rect[];
  onRedact: (rects: Rect[], kind: RedactKind) => void;
  onJumpToRect?: (rect: Rect) => void;
  ocr?: {
    unreadPages: number;
    ready: boolean;
    reading: boolean;
    downloading: boolean;
    onRead: () => void;
    onDownload: () => void;
  };
}) {
  const [redactKind, setRedactKind] = useState<RedactKind>('blur');
  const [query, setQuery] = useState('');
  const [wholeWord, setWholeWord] = useState(false);

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
  const open = found.filter((f) => !isCovered(f.rect, p.covered));
  const [off, setOff] = useState<Set<string>>(new Set());
  const key = (f: (typeof found)[number]) => `${f.run}:${f.start}`;
  const chosen = open.filter((f) => !off.has(key(f)));

  const customMatches = useMemo(() => {
    if (!query.trim()) return [];
    return findTextMatches(p.runs, query, { wholeWord, measure: measurer })
      .map((m) => {
        const cy = m.rect.y + m.rect.height / 2;
        const page = p.slices.findIndex((s) => cy >= s.y0 && cy < s.y1) + 1;
        const line = p.runs[m.runIndex]?.text ?? m.text;
        return { ...m, page, line };
      })
      .filter((m) => m.page > 0 || p.slices.length === 0);
  }, [p.runs, p.slices, query, wholeWord]);

  const openCustom = useMemo(
    () => customMatches.filter((m) => !isCovered(m.rect, p.covered)),
    [customMatches, p.covered],
  );

  const btn =
    'mt-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800';

  return (
    <section
      className="mb-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-700"
      data-testid="redact"
    >
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="font-semibold">{t('Personal data')}</h2>
        <div role="radiogroup" aria-label={t('Hide style')} className="flex gap-1 text-[11px]">
          {(
            [
              ['blur', 'Blur'],
              ['pixelate', 'Mosaic'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={redactKind === kind}
              onClick={() => setRedactKind(kind)}
              className={`rounded border px-1.5 py-0.5 ${
                redactKind === kind
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {p.ocr && p.ocr.unreadPages > 0 && (
        <div
          className="mb-2 rounded border border-accent/40 bg-accent/5 p-1.5 text-[12px]"
          data-testid="redact-ocr-prompt"
        >
          <p className="text-neutral-700 dark:text-neutral-200">
            {p.ocr.unreadPages === 1
              ? t('1 page is a picture and has not been read yet.')
              : t('{n} pages are pictures and have not been read yet.', { n: p.ocr.unreadPages })}
          </p>
          <button
            type="button"
            disabled={p.ocr.reading || p.ocr.downloading}
            onClick={p.ocr.ready ? p.ocr.onRead : p.ocr.onDownload}
            className={btn}
          >
            {p.ocr.ready ? t('Read pages now') : t('Download OCR model')}
          </button>
        </div>
      )}

      {!found.length ? (
        <p className="text-[12px] text-neutral-500">
          {t('No emails, phone, card or ID numbers in the page text.')}
        </p>
      ) : !open.length ? (
        <p className="text-[12px] text-neutral-500">
          {t('All {n} found are hidden.', { n: found.length })}
        </p>
      ) : (
        <>
          <p className="pb-1 text-[12px] text-neutral-500">
            {t('Found in the page text. Ticked ones are blurred and removed from the PDF.')}
          </p>
          <ul className="max-h-40 overflow-y-auto">
            {open.map((f) => (
              <li key={key(f)} className="flex items-center gap-1.5 py-0.5">
                <input
                  type="checkbox"
                  aria-label={`${KIND[f.kind]} ${f.text}`}
                  checked={!off.has(key(f))}
                  onChange={(e) => {
                    const next = new Set(off);
                    if (e.target.checked) next.delete(key(f));
                    else next.add(key(f));
                    setOff(next);
                  }}
                  className="accent-[#0e7c7b]"
                />
                <button
                  type="button"
                  onClick={() => p.onJumpToRect?.(f.rect)}
                  title={t('Jump to match')}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-0.5 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
                >
                  <span className="w-14 shrink-0 text-[11px] text-neutral-500">{KIND[f.kind]}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{f.text}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">
                    {f.page ? `p. ${f.page}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!chosen.length}
            onClick={() => {
              p.onRedact(
                chosen.map((f) => f.rect),
                redactKind,
              );
              setOff(new Set());
            }}
            className={btn}
          >
            {redactKind === 'blur'
              ? t('Blur {n} selected', { n: chosen.length })
              : t('Mosaic {n} selected', { n: chosen.length })}
          </button>
        </>
      )}

      <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-700">
        <label className="block text-[12px] font-medium" htmlFor="find-redact-input">
          {t('Find text to hide')}
        </label>
        <input
          id="find-redact-input"
          data-testid="find-redact-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Find text to hide')}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-[12px] focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:bg-neutral-900"
        />
        <label className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
            className="accent-[#0e7c7b]"
          />
          {t('Whole word')}
        </label>
        {query.trim() && (
          <div className="pt-1">
            {!customMatches.length ? (
              <p className="text-[12px] text-neutral-500">{t('No matches')}</p>
            ) : !openCustom.length ? (
              <p className="text-[12px] text-neutral-500">
                {t('All {n} found are hidden.', { n: customMatches.length })}
              </p>
            ) : (
              <>
                <p className="pb-1 text-[12px] text-neutral-500" data-testid="find-redact-count">
                  {openCustom.length === 1
                    ? t('1 match')
                    : t('{n} matches', { n: openCustom.length })}
                </p>
                <ul className="max-h-36 overflow-y-auto text-[11px]">
                  {openCustom.map((m, i) => (
                    <li key={`${m.runIndex}-${m.rect.x}-${i}`}>
                      <button
                        type="button"
                        onClick={() => p.onJumpToRect?.(m.rect)}
                        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">{m.line}</span>
                        <span className="shrink-0 text-neutral-500">
                          {m.page ? `p. ${m.page}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  data-testid="find-redact-apply"
                  onClick={() =>
                    p.onRedact(
                      openCustom.map((m) => m.rect),
                      redactKind,
                    )
                  }
                  className={btn}
                >
                  {redactKind === 'blur'
                    ? t('Blur {n} matches', { n: openCustom.length })
                    : t('Mosaic {n} matches', { n: openCustom.length })}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
