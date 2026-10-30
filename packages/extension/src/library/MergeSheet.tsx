import { buildFilename } from '@screenscroll/core';
import { DEFAULT_ENGINE } from '@screenscroll/core/ocr';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useState } from 'react';
import type { StoredCapture } from '@/shared/db';
import { loadSettings } from '@/shared/settings';
import { readImage } from '@/ocr/client';
import { modelStatus } from '@/ocr/store';
import { download } from '@/studio/engine/export';
import { exportMerged } from '@/studio/engine/merge';

const button =
  'rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800';
const icon =
  'rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 dark:hover:bg-neutral-800 dark:hover:text-white';

/**
 * Merge (UI §5): the chosen captures in order, each with a page range, saved as one PDF on
 * the paper and settings of Settings. Each capture is paginated as the Studio would.
 */
export function MergeSheet(p: { captures: StoredCapture[]; onClose: () => void }) {
  const [list, setList] = useState(() => p.captures.map((c) => ({ c, pages: '' })));
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const move = (i: number, d: -1 | 1) =>
    setList((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d]!, n[i]!];
      return n;
    });

  const save = async () => {
    setNote(null);
    setBusy('Starting');
    try {
      const settings = await loadSettings();
      const ocr =
        settings.ocr !== 'off' && (await modelStatus(DEFAULT_ENGINE).catch(() => null))?.ready
          ? { mode: settings.ocr, read: readImage }
          : undefined;
      const out = await exportMerged(
        list.map(({ c, pages }) => ({ id: c.session.id, pages })),
        settings,
        (stage, done, total) => setBusy(`${stage} ${done}/${total}`),
        ocr,
      );
      const first = list[0]!.c.session;
      const name = buildFilename(
        settings.filenameTemplate,
        { title: out.title, url: first.url, date: new Date() },
        'pdf',
      );
      const saved = await download(out.bytes, name, 'application/pdf');
      setNote(`Saved ${out.pages} pages as ${saved}`);
    } catch (e) {
      setNote(`Could not merge: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="Merge into one PDF"
      className="mt-3 rounded-lg border border-accent/50 bg-white p-3 dark:bg-neutral-900"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Merge into one PDF</h2>
        <button type="button" className={icon} aria-label="Close merge" onClick={p.onClose}>
          <X aria-hidden size={16} />
        </button>
      </div>
      <p className="pb-2 text-neutral-500">
        In this order, on the paper set in Settings. Pages: empty for all, or e.g. 1-3, 5.
      </p>
      <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {list.map(({ c, pages }, i) => {
          const title = c.session.title || c.session.url || 'Untitled capture';
          return (
            <li key={c.session.id} className="flex items-center gap-2 py-1.5">
              <span className="w-5 text-right font-mono text-neutral-500">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={title}>
                {title}
              </span>
              <input
                aria-label={`Pages of ${title}`}
                placeholder="all"
                value={pages}
                onChange={(e) =>
                  setList((l) => l.map((x, j) => (j === i ? { ...x, pages: e.target.value } : x)))
                }
                className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                type="button"
                className={icon}
                aria-label={`Move ${title} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp aria-hidden size={15} />
              </button>
              <button
                type="button"
                className={icon}
                aria-label={`Move ${title} down`}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown aria-hidden size={15} />
              </button>
              <button
                type="button"
                className={icon}
                aria-label={`Leave out ${title}`}
                disabled={list.length === 1}
                onClick={() => setList((l) => l.filter((_, j) => j !== i))}
              >
                <X aria-hidden size={15} />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void save()}
          className="rounded-md bg-accent px-3 py-1 font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        >
          Save as one PDF
        </button>
        <button type="button" className={button} onClick={p.onClose}>
          Cancel
        </button>
        <span role="status" className="text-neutral-500">
          {busy ?? note ?? ''}
        </span>
      </div>
    </section>
  );
}
