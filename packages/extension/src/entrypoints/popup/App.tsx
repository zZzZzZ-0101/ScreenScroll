import { blockedReason } from '@scrollpress/core';
import {
  Crosshair,
  FileDown,
  Monitor,
  ScanLine,
  SquareDashedMousePointer,
  Timer,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CaptureMode } from '@/lib/messages';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';

/**
 * UI §1, distilled: one obvious action, three alternatives, a timer. Everything else
 * (paper, formats, breaks) lives in the Studio, where you can see its effect.
 */
const OTHER: Array<[CaptureMode, string, typeof Monitor, string]> = [
  ['visible', 'Visible', Monitor, 'Only what is on screen (Alt+Shift+V)'],
  [
    'selection',
    'Area',
    SquareDashedMousePointer,
    'Drag a rectangle; it can be longer than the screen (Alt+Shift+S)',
  ],
  ['element', 'Element', Crosshair, 'Click a part of the page, like an article or a chat panel'],
];
const DELAYS = [0, 3, 5, 10];

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [delay, setDelay] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSettings().then(setSettings);
    // Say up front when this page can't be captured, instead of after a click.
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const info = blockedReason(tab?.url, await chrome.extension.isAllowedFileSchemeAccess());
      setBlocked(info?.message ?? null);
    })();
  }, []);

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

  const disabled = busy || !!blocked;
  const skip = settings?.afterCapture === 'pdf';

  return (
    <main className="w-72 bg-white p-3 text-[13px] text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <h1 className="mb-2 text-sm font-semibold">ScreenScroll</h1>

      {blocked ? (
        <p
          role="alert"
          className="mb-2 rounded-md bg-neutral-100 p-2 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {blocked}
        </p>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => void capture('full')}
        className="flex w-full items-center gap-3 rounded-lg bg-accent px-3 py-3 text-left text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <ScanLine aria-hidden size={22} />
        <span className="flex-1">
          <span className="block text-sm font-medium">Capture full page</span>
          <span className="block text-[12px] opacity-85">
            {skip ? 'Saves a PDF right away' : 'Then check the pages and save'}
          </span>
        </span>
        <kbd className="font-sans text-[11px] opacity-75">Alt+Shift+P</kbd>
      </button>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {OTHER.map(([mode, label, Icon, hint]) => (
          <button
            key={mode}
            type="button"
            title={hint}
            disabled={disabled}
            onClick={() => void capture(mode)}
            className="flex flex-col items-center gap-1 rounded-lg border border-neutral-200 py-2 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <Icon aria-hidden size={18} />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Timer aria-hidden size={15} className="text-neutral-500" />
        <span id="timer" className="text-neutral-600 dark:text-neutral-300">
          Timer
        </span>
        <div
          role="radiogroup"
          aria-labelledby="timer"
          className="ml-auto flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
        >
          {DELAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={delay === d}
              aria-label={d ? `${d} seconds` : 'No timer'}
              onClick={() => setDelay(d)}
              className={`rounded px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-accent ${delay === d ? 'bg-neutral-200 font-medium dark:bg-neutral-700' : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'}`}
            >
              {d ? `${d}s` : 'Off'}
            </button>
          ))}
        </div>
      </div>

      {settings && (
        <label className="mt-3 flex items-center gap-2 border-t border-neutral-200 pt-2 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => {
              // Show the change at once; storage catches up (a controlled box would flick back).
              const afterCapture = e.target.checked ? 'pdf' : 'studio';
              setSettings({ ...settings, afterCapture });
              void saveSettings({ afterCapture });
            }}
            className="accent-[#0e7c7b]"
          />
          <FileDown aria-hidden size={15} />
          Skip the preview and save the PDF
        </label>
      )}

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
