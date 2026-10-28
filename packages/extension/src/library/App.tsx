import { ExternalLink, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteCapture, deleteOlderThan, listCaptures, type StoredCapture } from '@/shared/db';
import { loadSettings, saveSettings } from '@/shared/settings';

const KEEP: Array<[number, string]> = [
  [0, 'Until I delete them'],
  [1, '1 day'],
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
];
/** Deletions wait this long so they can be undone (no "are you sure?" dialogs). */
const UNDO_MS = 6000;

/**
 * Saved captures (UI §4, first part): everything ScreenScroll keeps on this computer, how much
 * space it takes, and a way to reopen, delete or auto-clean it. Nothing is ever uploaded.
 */
export function App() {
  const [items, setItems] = useState<StoredCapture[] | null>(null);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [keepDays, setKeepDays] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ ids: string[]; timer: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

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

  // Leaving the page carries out a deletion that is still waiting for its undo window.
  useEffect(() => {
    const flush = () => {
      const p = pendingRef.current;
      if (p) for (const id of p.ids) void deleteCapture(id);
    };
    addEventListener('pagehide', flush);
    return () => removeEventListener('pagehide', flush);
  }, []);

  const remove = (ids: string[]) => {
    if (pending) {
      clearTimeout(pending.timer);
      for (const id of pending.ids) void deleteCapture(id);
    }
    const timer = window.setTimeout(async () => {
      for (const id of ids) await deleteCapture(id);
      setPending(null);
      await refresh();
    }, UNDO_MS);
    setPending({ ids, timer });
    setSelected(new Set());
  };
  const undo = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    setPending(null);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (c) =>
        !pending?.ids.includes(c.session.id) &&
        (!q || `${c.session.title} ${c.session.url}`.toLowerCase().includes(q)),
    );
  }, [items, query, pending]);
  const total = (items ?? []).reduce((n, c) => n + c.bytes, 0);

  return (
    <main className="mx-auto max-w-4xl p-6 text-[13px] text-neutral-900 dark:text-neutral-100">
      <h1 className="text-lg font-semibold">Saved captures</h1>
      <p className="text-neutral-500">
        Kept only on this computer, never uploaded. Open one to edit or export it again.
      </p>

      <section aria-label="Storage" className="mt-4 grid gap-3 sm:grid-cols-2">
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
        <label className="flex flex-1 items-center gap-2 rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
          <Search aria-hidden size={15} className="text-neutral-500" />
          <input
            type="search"
            aria-label="Search captures"
            placeholder="Search by title or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none"
          />
        </label>
        <button
          type="button"
          disabled={!selected.size}
          onClick={() => remove([...selected])}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <Trash2 aria-hidden size={15} /> Delete selected
          {selected.size ? ` (${selected.size})` : ''}
        </button>
      </div>

      {note && <p className="mt-2 text-neutral-500">{note}</p>}

      <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
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
            onDelete={() => remove([c.session.id])}
          />
        ))}
      </ul>

      {pending && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md bg-neutral-900 px-3 py-2 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending.ids.length === 1
            ? 'Capture deleted.'
            : `${pending.ids.length} captures deleted.`}
          <button type="button" onClick={undo} className="font-medium underline underline-offset-2">
            Undo
          </button>
        </div>
      )}
    </main>
  );
}

function Row(p: {
  item: StoredCapture;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onDelete: () => void;
}) {
  const { session, bytes, preview } = p.item;
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
        title="Delete"
        onClick={p.onDelete}
        className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-red-700 dark:hover:bg-neutral-800"
      >
        <Trash2 aria-hidden size={16} />
      </button>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
