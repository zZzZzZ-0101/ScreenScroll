import { blockedReason, PAPERS, type PaperId } from '@screenscroll/core';
import {
  Crosshair,
  Archive,
  History,
  Keyboard,
  Monitor,
  PanelTop,
  ScanLine,
  SquareDashedMousePointer,
  TextSelect,
  Timer,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { lastSession, listCaptures, type SessionRecord } from '@/shared/db';
import type { CaptureMode } from '@/shared/messages';
import { loadSettings, saveSettings, type Settings } from '@/shared/settings';

/**
 * UI §1: the small panel under the toolbar icon. One main action, every other way to
 * capture one click away, and the few settings worth changing before a capture.
 */
const MODES: Array<[CaptureMode, string, typeof Monitor, string]> = [
  ['visible', 'Visible', Monitor, 'Only what is on screen now (Alt+Shift+V)'],
  [
    'selection',
    'Area',
    SquareDashedMousePointer,
    'Drag a rectangle; drag past the edge to scroll (Alt+Shift+S)',
  ],
  [
    'lines',
    'Line to line',
    TextSelect,
    'Click the first line, scroll, click the last line: everything between',
  ],
  [
    'element',
    'Element',
    Crosshair,
    'Click one part of the page, like an article or a table (Alt+Shift+E)',
  ],
  [
    'pick-scroller',
    'Panel',
    PanelTop,
    'Click a panel that scrolls by itself: a mail list, a document viewer',
  ],
];
const DELAYS = [0, 3, 5, 10];

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [last, setLast] = useState<SessionRecord | null>(null);
  const [stored, setStored] = useState<{ count: number; bytes: number } | null>(null);
  const [delay, setDelay] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void lastSession()
      .then(setLast)
      .catch(() => setLast(null));
    void listCaptures()
      .then((all) => setStored({ count: all.length, bytes: all.reduce((n, c) => n + c.bytes, 0) }))
      .catch(() => setStored(null));
    // Say up front when this page can't be captured, instead of after a click.
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const info = blockedReason(tab?.url, await chrome.extension.isAllowedFileSchemeAccess());
      setBlocked(info?.message ?? null);
    })();
  }, []);

  const update = (patch: Partial<Settings>) => {
    // Show the change at once; storage catches up.
    setSettings((s) => s && { ...s, ...patch });
    void saveSettings(patch);
  };

  async function capture(mode: CaptureMode) {
    if (busy) return; // a double click must not start two captures
    setBusy(true);
    setError(null);
    // The timer is for menus and tooltips; the pickers wait for the user anyway.
    const delayMs = mode === 'full' || mode === 'visible' ? delay * 1000 : 0;
    const res = (await chrome.runtime
      .sendMessage({ type: 'sp:popup-capture', mode, delayMs })
      .catch((e: unknown) => ({ ok: false, error: String(e) }))) as { ok: boolean; error?: string };
    if (res.ok) window.close();
    else {
      setError(res.error ?? 'Capture failed.');
      setBusy(false);
    }
  }

  const open = (url: string) => {
    void chrome.tabs.create({ url });
    window.close();
  };

  const disabled = busy || !!blocked;
  const segment = (on: boolean) =>
    `rounded px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-accent ${on ? 'bg-neutral-200 font-medium dark:bg-neutral-700' : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'}`;
  const row = 'flex items-center justify-between gap-2 py-1';

  return (
    <main className="w-80 bg-white p-3 text-[13px] text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-sm font-semibold">ScreenScroll</h1>
        <button
          type="button"
          title="Change keyboard shortcuts"
          aria-label="Change keyboard shortcuts"
          onClick={() => open('chrome://extensions/shortcuts')}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
        >
          <Keyboard aria-hidden size={16} />
        </button>
      </header>

      {blocked && (
        <p
          role="alert"
          className="mb-2 rounded-md bg-neutral-100 p-2 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {blocked}
        </p>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => void capture('full')}
        className="flex w-full items-center gap-3 rounded-lg bg-accent px-3 py-2.5 text-left text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <ScanLine aria-hidden size={22} />
        <span className="flex-1">
          <span className="block text-sm font-medium">Capture full page</span>
          <span className="block text-[12px] opacity-85">
            {settings?.afterCapture === 'pdf'
              ? 'Saves a PDF right away'
              : 'Then check the pages and save'}
          </span>
        </span>
        <kbd className="font-sans text-[11px] opacity-75">Alt+Shift+P</kbd>
      </button>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {MODES.map(([mode, label, Icon, hint]) => (
          <button
            key={mode}
            type="button"
            title={hint}
            disabled={disabled}
            onClick={() => void capture(mode)}
            className="flex flex-col items-center gap-1 rounded-lg border border-neutral-200 px-1 py-2 text-center hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Icon aria-hidden size={18} />
            <span className="leading-tight">{label}</span>
          </button>
        ))}
      </div>

      <section
        aria-label="Settings"
        className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-700"
      >
        <div className={row}>
          <span
            id="timer"
            className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300"
          >
            <Timer aria-hidden size={14} /> Timer
          </span>
          <div
            role="radiogroup"
            aria-labelledby="timer"
            className="flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
          >
            {DELAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={delay === d}
                aria-label={d ? `${d} seconds` : 'No timer'}
                onClick={() => setDelay(d)}
                className={segment(delay === d)}
              >
                {d ? `${d}s` : 'Off'}
              </button>
            ))}
          </div>
        </div>
        {settings && (
          <>
            <div className={row}>
              <span id="after" className="text-neutral-600 dark:text-neutral-300">
                After capture
              </span>
              <div
                role="radiogroup"
                aria-labelledby="after"
                className="flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
              >
                {(
                  [
                    ['studio', 'Review'],
                    ['pdf', 'Save PDF'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={settings.afterCapture === v}
                    onClick={() => update({ afterCapture: v })}
                    className={segment(settings.afterCapture === v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className={row}>
              <span className="text-neutral-600 dark:text-neutral-300">Paper</span>
              <select
                className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
                value={typeof settings.page.paper === 'string' ? settings.page.paper : 'A4'}
                onChange={(e) =>
                  update({ page: { ...settings.page, paper: e.target.value as PaperId } })
                }
              >
                {Object.keys(PAPERS).map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      {last && (
        <button
          type="button"
          onClick={() =>
            open(chrome.runtime.getURL(`/studio.html?session=${encodeURIComponent(last.id)}`))
          }
          className="mt-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-neutral-300 dark:hover:bg-neutral-800"
          title="Open the last capture in the Studio"
        >
          <History aria-hidden size={15} className="shrink-0" />
          <span className="truncate">Last capture: {last.title || last.url}</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => open(chrome.runtime.getURL('/captures.html'))}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-neutral-300 dark:hover:bg-neutral-800"
        title="See, reopen or delete what ScreenScroll keeps on this computer"
      >
        <Archive aria-hidden size={15} className="shrink-0" />
        <span className="truncate">
          Saved captures
          {stored &&
            ` · ${stored.count} · ${stored.bytes < 1048576 ? `${Math.round(stored.bytes / 1024)} KB` : `${(stored.bytes / 1048576).toFixed(1)} MB`}`}
        </span>
      </button>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {error}
        </p>
      )}
    </main>
  );
}
