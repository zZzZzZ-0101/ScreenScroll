import { diffText, textToMarkdown, type TextChange } from '@screenscroll/core';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StoredCapture } from '@/shared/db';
import { t } from '@/shared/i18n';
import { loadSession } from '@/studio/engine/session';
import { comparePictures, type PictureCrop, type PictureDiff } from './picture-diff';

/** Markdown's heading and list markers aren't part of what the page said. */
const plain = (s: string) => s.replace(/^(#{1,3}|-) /, '');

/** A capture's text as paragraphs, the same way Save → Text (Markdown) writes it. */
async function textOf(id: string): Promise<string> {
  const s = await loadSession(id);
  return textToMarkdown(s.hints.textRuns, s.hints.headings);
}

/**
 * M8 "what changed": two captures' text compared paragraph by paragraph, older first;
 * edited paragraphs show the words that changed. Runs of unchanged paragraphs fold up.
 */
export function CompareSheet(p: { captures: [StoredCapture, StoredCapture]; onClose: () => void }) {
  const [older, newer] = [...p.captures].sort((a, b) =>
    a.session.capturedAt.localeCompare(b.session.capturedAt),
  ) as [StoredCapture, StoredCapture];
  const [changes, setChanges] = useState<TextChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pictures, setPictures] = useState<PictureDiff | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  useEffect(() => {
    let urls: string[] = [];
    void comparePictures(older.session.id, newer.session.id).then(
      (d) => {
        urls = d.shown.flatMap((s) => [s.before?.url, s.after?.url]).filter((u): u is string => !!u);
        setPictures(d);
      },
      (e: unknown) => setPictureError(e instanceof Error ? e.message : String(e)),
    );
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [older.session.id, newer.session.id]);
  useEffect(() => {
    void Promise.all([textOf(older.session.id), textOf(newer.session.id)]).then(
      ([a, b]) => setChanges(diffText(a, b)),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [older.session.id, newer.session.id]);

  const count = (k: TextChange['kind']) => changes?.filter((c) => c.kind === k).length ?? 0;
  const when = (c: StoredCapture) => new Date(c.session.capturedAt).toLocaleString();
  // Fold runs of unchanged paragraphs, keeping one on each side of a change for context.
  const shown: Array<TextChange | { kind: 'fold'; n: number }> = [];
  if (changes) {
    changes.forEach((c, i) => {
      const near = changes[i - 1]?.kind !== 'same' || changes[i + 1]?.kind !== 'same';
      if (c.kind !== 'same' || near) shown.push(c);
      else {
        const last = shown.at(-1);
        if (last?.kind === 'fold') last.n++;
        else shown.push({ kind: 'fold', n: 1 });
      }
    });
  }
  return (
    <div
      role="dialog"
      aria-label={t('Compare captures')}
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
    >
      <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('What changed')}</h2>
          <button
            type="button"
            aria-label={t('Close')}
            onClick={p.onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X aria-hidden size={16} />
          </button>
        </div>
        <p className="text-[12px] text-neutral-500">
          {t('From')} {older.session.title || older.session.url} · {when(older)}
          <br />
          {t('To')} {newer.session.title || newer.session.url} · {when(newer)}
        </p>
        {error && <p role="alert" className="pt-2 text-red-700 dark:text-red-300">{error}</p>}
        {!changes && !error && <p className="pt-2 text-neutral-500">{t('Comparing…')}</p>}
        {changes && (
          <>
            <p className="pt-2 font-mono text-[12px]" data-testid="compare-summary">
              +{count('add')} −{count('del')} ~{count('edit')} · {count('same')} {t('unchanged')}
            </p>
            {count('add') + count('del') + count('edit') === 0 ? (
              <p className="pt-2">{t('No differences in the text.')}</p>
            ) : (
              <div className="mt-2 space-y-1.5 text-[13px]" data-testid="compare-changes">
                {shown.map((c, i) =>
                  c.kind === 'fold' ? (
                    <p key={i} className="text-[12px] text-neutral-400">
                      … {t('{n} unchanged', { n: c.n })}
                    </p>
                  ) : c.kind === 'same' ? (
                    <p key={i} className="text-neutral-500">{plain(c.text)}</p>
                  ) : c.kind === 'add' ? (
                    <p key={i} className="rounded bg-green-50 px-1 dark:bg-green-950" data-change="add">
                      + {plain(c.text)}
                    </p>
                  ) : c.kind === 'del' ? (
                    <p key={i} className="rounded bg-red-50 px-1 line-through dark:bg-red-950" data-change="del">
                      − {plain(c.text)}
                    </p>
                  ) : (
                    <p key={i} className="rounded bg-amber-50 px-1 dark:bg-amber-950" data-change="edit">
                      ~{' '}
                      {c.words.map((w, k) => (
                        <span
                          key={k}
                          className={
                            w.kind === 'add'
                              ? 'bg-green-200 dark:bg-green-800'
                              : w.kind === 'del'
                                ? 'bg-red-200 line-through dark:bg-red-800'
                                : undefined
                          }
                        >
                          {w.text}{' '}
                        </span>
                      ))}
                    </p>
                  ),
                )}
              </div>
            )}
          </>
        )}
        <h3 className="pt-4 font-semibold">{t('Pictures')}</h3>
        {pictureError && (
          <p role="alert" className="pt-1 text-red-700 dark:text-red-300">
            {pictureError}
          </p>
        )}
        {!pictures && !pictureError && <p className="pt-1 text-neutral-500">{t('Comparing…')}</p>}
        {pictures && (
          <div data-testid="picture-summary">
            {!pictures.changes ? (
              <p className="pt-1">
                {t('Captured at different widths ({a} and {b} px), so the pictures are not compared row by row.', {
                  a: pictures.widths[0],
                  b: pictures.widths[1],
                })}
              </p>
            ) : pictures.changes.length === 0 ? (
              <p className="pt-1">{t('No differences in the pictures.')}</p>
            ) : (
              <>
                <p className="pt-1">
                  {pictures.changes.length === 1
                    ? t('1 area looks different.')
                    : t('{n} areas look different.', { n: pictures.changes.length })}
                  {pictures.changes.length > pictures.shown.length &&
                    ' ' + t('The first {n} are shown.', { n: pictures.shown.length })}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-neutral-500">
                  <span>{t('Before')}</span>
                  <span>{t('After')}</span>
                  {pictures.shown.map((s, i) => (
                    <PicturePair key={i} before={s.before} after={s.after} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PicturePair(p: { before: PictureCrop | null; after: PictureCrop | null }) {
  const cell = (c: PictureCrop | null, kind: 'del' | 'add') =>
    c ? (
      <figure data-picture={kind}>
        <img
          src={c.url}
          alt=""
          className={`w-full rounded border-2 ${kind === 'del' ? 'border-red-400' : 'border-green-500'}`}
        />
        <figcaption>
          {Math.round(c.y0)}–{Math.round(c.y1)} px{c.clipped ? ' …' : ''}
        </figcaption>
      </figure>
    ) : (
      <p className="self-center text-center">{kind === 'del' ? t('(nothing before)') : t('(removed)')}</p>
    );
  return (
    <>
      {cell(p.before, 'del')}
      {cell(p.after, 'add')}
    </>
  );
}
