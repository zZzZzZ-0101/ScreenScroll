import { blockedReason } from '@screenscroll/core';
import { CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  BATCH_KEY,
  failedTargets,
  parseUrls,
  type BatchItem,
  type BatchStart,
  type BatchState,
  type BatchTarget,
} from '@/shared/batch';
import type { BatchCancel } from '@/shared/messages';
import { isFileAccessAllowed } from '@/shared/capabilities';
import { listCaptures, type StoredCapture } from '@/shared/db';
import { MergeSheet } from '@/library/MergeSheet';
import { t } from '@/shared/i18n';

const ALL_SITES = { origins: ['<all_urls>'] };
const button =
  'rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800';
const primary =
  'rounded-md bg-accent px-3 py-1 font-medium text-white hover:bg-accent-strong disabled:opacity-50';
const card =
  'rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900';

type TabRow = { id: number; title: string; url: string; blocked: string | null };

/**
 * Capture several pages (ROADMAP M5): every tab of this window, or a list of addresses, one
 * full-page capture each, saved together; then one PDF of them all, or each on its own.
 */
export function App() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tabs, setTabs] = useState<TabRow[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [text, setText] = useState('');
  const [state, setState] = useState<BatchState | null>(null);
  const [merging, setMerging] = useState<StoredCapture[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const readTabs = async () => {
    const me = await chrome.tabs.getCurrent();
    const fileAccess = await isFileAccessAllowed();
    const list = await chrome.tabs.query({ windowId: me?.windowId });
    const rows = list
      .filter((tab) => tab.id !== undefined && tab.id !== me?.id)
      .map((tab) => ({
        id: tab.id!,
        title: tab.title || tab.url || t('Untitled tab'),
        url: tab.url ?? '',
        blocked: blockedReason(tab.url, fileAccess)?.message ?? null,
      }));
    setTabs(rows);
    setChosen(new Set(rows.filter((r) => !r.blocked).map((r) => r.id)));
  };

  useEffect(() => {
    void (async () => {
      const ok = await chrome.permissions.contains(ALL_SITES);
      setAllowed(ok);
      if (ok) await readTabs();
      const sessionBag = await chrome.storage.session?.get(BATCH_KEY);
      const stored = sessionBag?.[BATCH_KEY] as BatchState | undefined;
      if (stored) setState(stored);
    })();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[BATCH_KEY]) {
        const next = changes[BATCH_KEY].newValue as BatchState;
        setState(next);
        if (!next.running) setStopping(false);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const allow = async () => {
    // Asked here, when it's needed, never at install: other tabs can't be captured without it.
    const ok = await chrome.permissions.request(ALL_SITES);
    setAllowed(ok);
    if (ok) await readTabs();
  };

  const start = async (targets: BatchTarget[]) => {
    setNote(null);
    setMerging(null);
    setStopping(false);
    const me = await chrome.tabs.getCurrent();
    if (!me?.id) return;
    const msg: BatchStart = { type: 'sp:batch-start', targets, windowId: me.windowId, homeTabId: me.id };
    await chrome.runtime.sendMessage(msg);
  };

  const stopBatch = async () => {
    if (stopping) return;
    setStopping(true);
    await chrome.runtime.sendMessage({ type: 'sp:batch-cancel' } satisfies BatchCancel).catch(() => undefined);
  };

  const parsed = useMemo(() => parseUrls(text), [text]);
  const running = !!state?.running;
  const captured = (state?.items ?? []).filter((i) => i.status === 'done' && i.sessionId);
  const retryable = useMemo(() => failedTargets(state?.items ?? []), [state]);

  const mergeAll = async () => {
    const ids = captured.map((i) => i.sessionId!);
    const all = await listCaptures();
    const byId = new Map(all.map((c) => [c.session.id, c]));
    const list = ids.map((id) => byId.get(id)).filter((c): c is StoredCapture => !!c);
    if (list.length) setMerging(list);
    else setNote(t('Those captures are no longer saved.'));
  };

  return (
    <main className="mx-auto max-w-3xl p-6 text-[13px] text-neutral-900 dark:text-neutral-100">
      <h1 className="text-lg font-semibold">{t('Capture several pages')}</h1>
      <p className="text-neutral-500">
        {t(
          'One full-page capture each, one after another. Each page comes to the front while it is captured. Then save them as one PDF, or open them one by one.',
        )}
      </p>

      {allowed === false && (
        <section aria-label={t('Permission')} className={`${card} mt-4`}>
          <p>
            {t(
              'To capture pages other than the one you clicked on, ScreenScroll needs the browser’s permission to read and capture all sites. Nothing is sent anywhere.',
            )}
          </p>
          <button type="button" className={`${primary} mt-2`} onClick={() => void allow()}>
            {t('Allow')}
          </button>
        </section>
      )}

      {allowed && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <section aria-label={t('Tabs in this window')} className={card}>
            <h2 className="pb-1 font-medium">{t('Tabs in this window')}</h2>
            <ul className="max-h-72 overflow-y-auto">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <label
                    className={`flex items-start gap-2 py-0.5 ${tab.blocked ? 'text-neutral-400' : ''}`}
                    title={tab.blocked ?? tab.url}
                  >
                    <input
                      type="checkbox"
                      disabled={!!tab.blocked || running}
                      checked={chosen.has(tab.id)}
                      onChange={(e) =>
                        setChosen((c) => {
                          const n = new Set(c);
                          if (e.target.checked) n.add(tab.id);
                          else n.delete(tab.id);
                          return n;
                        })
                      }
                      className="mt-0.5 accent-[#0e7c7b]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{tab.title}</span>
                      {tab.blocked && (
                        <span className="block text-[12px]">
                          {tab.blocked.split('. ')[0]?.replace(/\.?$/, '.')}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
              {!tabs.length && <li className="text-neutral-500">{t('No other tabs.')}</li>}
            </ul>
            <button
              type="button"
              className={`${primary} mt-2`}
              disabled={running || !chosen.size}
              onClick={() =>
                void start(
                  tabs
                    .filter((tab) => chosen.has(tab.id))
                    .map((tab) => ({ kind: 'tab', tabId: tab.id }) as const),
                )
              }
            >
              {chosen.size === 1
                ? t('Capture 1 tab')
                : t('Capture {n} tabs', { n: chosen.size })}
            </button>
          </section>

          <section aria-label={t('Addresses')} className={card}>
            <h2 className="pb-1 font-medium">{t('Addresses')}</h2>
            <textarea
              aria-label={t('Addresses, one per line')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'example.com/report\nexample.com/notes'}
              rows={8}
              disabled={running}
              className="w-full rounded-md border border-neutral-300 bg-white p-2 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900"
            />
            {parsed.rejected.length > 0 && (
              <p className="text-[12px] text-amber-700 dark:text-amber-400">
                {t('Not web addresses, left out: {items}', { items: parsed.rejected.join(', ') })}
              </p>
            )}
            <p className="text-[12px] text-neutral-500">
              {t('Each opens in a new tab, is captured once loaded (at most 30 s), and the tab closes.')}
            </p>
            <button
              type="button"
              className={`${primary} mt-2`}
              disabled={running || !parsed.urls.length}
              onClick={() => void start(parsed.urls.map((url) => ({ kind: 'url', url }) as const))}
            >
              {parsed.urls.length === 1
                ? t('Capture 1 address')
                : t('Capture {n} addresses', { n: parsed.urls.length })}
            </button>
          </section>
        </div>
      )}

      {state && state.items.length > 0 && (
        <section aria-label={t('Progress')} className={`${card} mt-4`}>
          <div className="flex items-center justify-between gap-2 pb-1">
            <h2 className="font-medium">
              {running
                ? t('Capturing {done} of {total}', {
                    done:
                      state.items.filter((i) => i.status !== 'waiting' && i.status !== 'capturing')
                        .length + 1,
                    total: state.items.length,
                  })
                : t('Done: {done} of {total} captured', {
                    done: captured.length,
                    total: state.items.length,
                  })}
            </h2>
            {running && (
              <button
                type="button"
                className={button}
                disabled={stopping}
                onClick={() => void stopBatch()}
              >
                {stopping ? t('Stopping…') : t('Stop batch')}
              </button>
            )}
          </div>
          <ol className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {state.items.map((item, i) => (
              <ItemRow key={i} item={item} />
            ))}
          </ol>
          {!running && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primary}
                disabled={!captured.length}
                onClick={() => void mergeAll()}
              >
                {t('Merge into one PDF')}
              </button>
              {retryable.length > 0 && (
                <button
                  type="button"
                  className={button}
                  onClick={() => void start(retryable)}
                >
                  {t('Retry failed')} ({retryable.length})
                </button>
              )}
              <button
                type="button"
                className={button}
                onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/captures.html') })}
              >
                {t('Open saved captures')}
              </button>
              {note && (
                <span role="status" className="text-neutral-500">
                  {note}
                </span>
              )}
            </div>
          )}
          {merging && <MergeSheet captures={merging} onClose={() => setMerging(null)} />}
        </section>
      )}
    </main>
  );
}

const ICON: Record<BatchItem['status'], [typeof CheckCircle2, string, string]> = {
  waiting: [CircleDashed, 'text-neutral-400', 'Waiting'],
  capturing: [Loader2, 'text-accent animate-spin', 'Capturing'],
  done: [CheckCircle2, 'text-accent', 'Captured'],
  skipped: [MinusCircle, 'text-neutral-500', 'Skipped'],
  failed: [XCircle, 'text-red-700 dark:text-red-400', 'Failed'],
};

function ItemRow({ item }: { item: BatchItem }) {
  const [Icon, cls, word] = ICON[item.status];
  return (
    <li className="flex items-start gap-2 py-1" data-status={item.status}>
      <Icon aria-hidden size={15} className={`mt-0.5 shrink-0 ${cls}`} />
      <div className="min-w-0">
        <p className="truncate" title={item.url}>
          <span className="sr-only">{t(word)}: </span>
          {item.label}
        </p>
        {item.reason && <p className="text-[12px] text-neutral-500">{item.reason}</p>}
      </div>
    </li>
  );
}
