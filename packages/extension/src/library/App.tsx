import { ArchiveRestore, Download, ExternalLink, Files, ImageUp, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteCapture, deleteOlderThan, listCaptures, type StoredCapture } from '@/shared/db';
import { loadSettings, saveSettings } from '@/shared/settings';
import { backupCaptures, restoreCaptures } from '@/shared/backup';
import { importImage } from '@/shared/import-image';
import { MergeSheet } from './MergeSheet';
import { t } from '@/shared/i18n';

const KEEP: Array<[number, string]> = [
  [0, 'Until I delete them'],
  [1, '1 day'],
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
];

/**
 * Saved captures (UI §4, first part): everything ScreenScroll keeps on this computer, how much
 * space it takes, and a way to reopen, delete (for good, nothing left behind) or auto-clean it.
 * Nothing is ever uploaded.
 */
export function App() {
  const [items, setItems] = useState<StoredCapture[] | null>(null);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [keepDays, setKeepDays] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Deleting several at once asks once more, in place: "Delete 5 captures?". */
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Captures being merged, in the list's order (oldest first, the usual reading order). */
  const [merging, setMerging] = useState<StoredCapture[] | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listCaptures());
    const est = await navigator.storage?.estimate?.();
    if (est) setQuota({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
  }, []);

  useEffect(() => {
    document.title = 'Saved captures · ScreenScroll';
    void (async () => {
      const s = await loadSettings();
      setKeepDays(s.keepDays);
      if (s.keepDays) {
        const n = await deleteOlderThan(s.keepDays);
        if (n)
          setNote(
            `${n} capture${n === 1 ? '' : 's'} older than ${s.keepDays} days ${n === 1 ? 'was' : 'were'} deleted.`,
          );
      }
      await refresh();
    })();
  }, [refresh]);

  /** Deletes for good: the capture's record and every frame image, then re-reads the list. */
  const remove = async (ids: string[]) => {
    if (busy || !ids.length) return;
    setBusy(true);
    setConfirm(null);
    try {
      for (const id of ids) await deleteCapture(id);
      setSelected(new Set());
      setNote(ids.length === 1 ? 'Capture deleted.' : `${ids.length} captures deleted.`);
    } catch (e) {
      setNote(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (c) => !q || `${c.session.title} ${c.session.url} ${c.text}`.toLowerCase().includes(q),
    );
  }, [items, query]);
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.session.id));
  const total = (items ?? []).reduce((n, c) => n + c.bytes, 0);

  return (
    <main className="mx-auto max-w-4xl p-6 text-[13px] text-neutral-900 dark:text-neutral-100">
      <h1 className="text-lg font-semibold">Saved captures</h1>
      <p className="text-neutral-500">
        {t('Kept only on this computer, never uploaded. Open one to edit or export it again.')}
      </p>

      <section aria-label={t('Storage')} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="font-medium">Space used</h2>
          <p className="text-neutral-500" data-testid="space">
            {items === null
              ? 'Measuring'
              : `${items.length} ${items.length === 1 ? 'capture' : 'captures'} · ${formatBytes(total)}`}
            {quota &&
              quota.quota > 0 &&
              ` · ${formatBytes(quota.quota - quota.usage)} free for ScreenScroll`}
          </p>
        </div>
        <label className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="block font-medium">Keep captures</span>
          <span className="block pb-1 text-neutral-500">Older ones are deleted automatically.</span>
          <select
            value={keepDays}
            onChange={(e) => {
              const v = Number(e.target.value);
              setKeepDays(v);
              void saveSettings({ keepDays: v });
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {KEEP.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="mt-4 flex items-center gap-2">
        <label
          className="flex cursor-pointer items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-within:outline-2 focus-within:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-800"
          title={t('Open a long screenshot (PNG, JPEG, WebP) as a capture')}
        >
          <ImageUp aria-hidden size={15} /> Open an image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={t('Open an image file')}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setNote(`Opening ${file.name}…`);
              importImage(file).then(
                (id) => {
                  setNote(null);
                  void refresh();
                  void chrome.tabs.create({
                    url: chrome.runtime.getURL(`/studio.html?session=${encodeURIComponent(id)}`),
                  });
                },
                (err: unknown) => setNote(err instanceof Error ? err.message : String(err)),
              );
            }}
          />
        </label>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          disabled={!items?.length}
          title={t('Save captures, images included, to one file (the selected ones, or all)')}
          onClick={() => {
            const ids = [...selected];
            setNote('Writing the backup…');
            void backupCaptures(ids).then((blob) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `screenscroll-captures-${new Date().toISOString().slice(0, 10)}.ssbackup`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
              setNote(
                `Backup of ${ids.length || items!.length} ${(ids.length || items!.length) === 1 ? 'capture' : 'captures'} saved (${(blob.size / 1048576).toFixed(1)} MB).`,
              );
            });
          }}
        >
          <Download aria-hidden size={15} /> Back up{selected.size ? ` (${selected.size})` : ''}
        </button>
        <label
          className="flex cursor-pointer items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 focus-within:outline-2 focus-within:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-800"
          title={t('Add the captures from a backup file')}
        >
          <ArchiveRestore aria-hidden size={15} /> Restore
          <input
            type="file"
            accept=".ssbackup"
            aria-label={t('Restore from a backup file')}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setNote(`Restoring ${file.name}…`);
              restoreCaptures(file).then(
                ({ added, skipped }) => {
                  void refresh();
                  setNote(
                    `${added} ${added === 1 ? 'capture' : 'captures'} restored` +
                      (skipped ? `; ${skipped} already here, left as they are.` : '.'),
                  );
                },
                (err: unknown) => setNote(err instanceof Error ? err.message : String(err)),
              );
            }}
          />
        </label>
        <label className="flex flex-1 items-center gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
          <Search aria-hidden size={15} className="text-neutral-500" />
          <input
            type="search"
            aria-label={t('Search captures')}
            placeholder={t('Search titles, addresses and page text')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none"
          />
        </label>
        {confirm ? (
          <span className="flex items-center gap-1" role="group" aria-label={t('Confirm deletion')}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(confirm)}
              className="rounded-md bg-red-700 px-2 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              Delete {confirm.length} for good
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('Cancel')}
            </button>
          </span>
        ) : (
          <>
          <button
            type="button"
            disabled={selected.size < 2 || busy}
            title={t('Save the selected captures as one PDF')}
            onClick={() =>
              setMerging(
                (items ?? [])
                  .filter((c) => selected.has(c.session.id) && c.session.frameCount > 0)
                  .reverse(),
              )
            }
            className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Files aria-hidden size={15} /> Merge into one PDF
            {selected.size > 1 ? ` (${selected.size})` : ''}
          </button>
          <button
            type="button"
            disabled={!selected.size || busy}
            onClick={() => setConfirm([...selected])}
            className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Trash2 aria-hidden size={15} /> Delete selected
            {selected.size ? ` (${selected.size})` : ''}
          </button>
          </>
        )}
      </div>

      {note && (
        <p role="status" className="mt-2 text-neutral-500">
          {note}
        </p>
      )}

      {merging && <MergeSheet captures={merging} onClose={() => setMerging(null)} />}

      {visible.length > 0 && (
        <div className="mt-3 flex items-center justify-between px-2">
          <label className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) =>
                setSelected(
                  e.target.checked ? new Set(visible.map((c) => c.session.id)) : new Set(),
                )
              }
              className="accent-[#0e7c7b]"
            />
            Select all{query ? ' shown' : ''} ({visible.length})
          </label>
          {!confirm && (items?.length ?? 0) > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm((items ?? []).map((c) => c.session.id))}
              className="text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
            >
              {t('Delete all captures')}
            </button>
          )}
        </div>
      )}

      <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        {items !== null && !visible.length && (
          <li className="p-4 text-neutral-500">
            {query ? 'No capture matches.' : 'No saved captures.'}
          </li>
        )}
        {visible.map((c) => (
          <Row
            key={c.session.id}
            item={c}
            checked={selected.has(c.session.id)}
            onCheck={(on) =>
              setSelected((s) => {
                const n = new Set(s);
                if (on) n.add(c.session.id);
                else n.delete(c.session.id);
                return n;
              })
            }
            onDelete={() => void remove([c.session.id])}
            busy={busy}
            query={query}
          />
        ))}
      </ul>
    </main>
  );
}

function Row(p: {
  item: StoredCapture;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onDelete: () => void;
  busy: boolean;
  query: string;
}) {
  const { session, bytes, preview, text } = p.item;
  const hit = snippet(text, p.query, `${session.title} ${session.url}`);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!preview) return;
    const url = URL.createObjectURL(preview);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  const title = session.title || session.url || 'Untitled capture';
  const when = new Date(session.capturedAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  let site = '';
  try {
    site = new URL(session.url).hostname.replace(/^www\./, '');
  } catch {
    /* not a web address */
  }
  return (
    <li className="flex items-center gap-3 p-2" data-testid="capture-row">
      <input
        type="checkbox"
        aria-label={`Select ${title}`}
        checked={p.checked}
        onChange={(e) => p.onCheck(e.target.checked)}
        className="accent-[#0e7c7b]"
      />
      <div className="h-12 w-20 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800">
        {src && (
          <img src={src} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={title}>
          {title}
        </p>
        <p className="truncate text-neutral-500">
          {[site, when, formatBytes(bytes), session.status !== 'complete' ? 'incomplete' : '']
            .filter(Boolean)
            .join(' · ')}
        </p>
        {hit && (
          <p className="truncate text-neutral-600 dark:text-neutral-300" data-testid="snippet">
            …{hit.before}
            <mark className="rounded-sm bg-amber-200 px-0.5 text-neutral-900">{hit.match}</mark>
            {hit.after}…
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={!session.frameCount}
        onClick={() =>
          void chrome.tabs.create({
            url: chrome.runtime.getURL(`/studio.html?session=${encodeURIComponent(session.id)}`),
          })
        }
        className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        <ExternalLink aria-hidden size={14} /> Open
      </button>
      <button
        type="button"
        aria-label={`Delete ${title}`}
        title={t('Delete for good')}
        disabled={p.busy}
        onClick={p.onDelete}
        className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-red-700 dark:hover:bg-neutral-800"
      >
        <Trash2 aria-hidden size={16} />
      </button>
    </li>
  );
}

/**
 * Where the search matched in the page text, with some words around it; null when the title
 * or address already shows why the capture matched, or nothing matched.
 */
function snippet(text: string, query: string, shown: string) {
  const q = query.trim().toLowerCase();
  if (!q || shown.toLowerCase().includes(q)) return null;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return null;
  return {
    before: text.slice(Math.max(0, i - 50), i),
    match: text.slice(i, i + q.length),
    after: text.slice(i + q.length, i + q.length + 80),
  };
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
