import { useEffect, useState } from 'react';
import { PAPERS, type PaperId } from '@scrollpress/core';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';

import type { CaptureMode } from '@/lib/messages';

const SECONDARY: Array<[CaptureMode, string, string]> = [
  ['visible', 'Visible area', 'Alt+Shift+V'],
  ['selection', 'Select area', 'Alt+Shift+S'],
  ['element', 'Pick element', ''],
  ['pick-scroller', 'Pick scroll area', ''],
];
const DELAYS = [0, 3, 5, 10];

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
  const update = async (patch: Partial<Settings>) => setSettings(await saveSettings(patch));
  const [delay, setDelay] = useState(0);

  async function capture(mode: CaptureMode) {
    setError(null);
    // The delay is for menus and tooltips on full-page and visible captures; the pickers wait
    // for the user anyway.
    const delayMs = mode === 'full' || mode === 'visible' ? delay * 1000 : 0;
    const res = (await chrome.runtime.sendMessage({ type: 'sp:popup-capture', mode, delayMs })) as {
      ok: boolean;
      error?: string;
    };
    if (res.ok) window.close();
    else setError(res.error ?? 'Capture failed.');
  }

  return (
    <main className="w-80 bg-white p-3 text-[13px] text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <h1 className="mb-3 text-sm font-semibold">ScrollPress</h1>
      <button
        type="button"
        onClick={() => void capture('full')}
        className="flex w-full justify-between rounded-md bg-accent px-3 py-2 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span>Capture full page</span>
        <kbd className="font-sans opacity-80">Alt+Shift+P</kbd>
      </button>
      {SECONDARY.map(([mode, label, key]) => (
        <button
          key={mode}
          type="button"
          onClick={() => void capture(mode)}
          className="mt-1 flex w-full justify-between rounded-md px-3 py-1.5 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
        >
          <span>{label}</span>
          {key && <kbd className="font-sans text-neutral-500">{key}</kbd>}
        </button>
      ))}
      <label className="mt-1 flex items-center justify-between px-3 py-1">
        <span>Delay</span>
        <select
          value={delay}
          onChange={(e) => setDelay(Number(e.target.value))}
          className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {DELAYS.map((d) => (
            <option key={d} value={d}>
              {d ? `${d} s` : 'Off'}
            </option>
          ))}
        </select>
      </label>
      {settings && (
        <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-700">
          <fieldset>
            <legend className="mb-1 text-neutral-500">After capture</legend>
            {(
              [
                ['studio', 'Open Studio'],
                ['pdf', 'Save PDF directly'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="mr-3 inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="after"
                  checked={settings.afterCapture === value}
                  onChange={() => void update({ afterCapture: value })}
                  className="accent-[#0e7c7b]"
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="mt-2 flex items-center justify-between">
            <span className="text-neutral-500">Paper</span>
            <select
              className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 dark:border-neutral-700 dark:bg-neutral-900"
              value={typeof settings.page.paper === 'string' ? settings.page.paper : 'A4'}
              onChange={(e) =>
                void update({ page: { ...settings.page, paper: e.target.value as PaperId } })
              }
            >
              {Object.keys(PAPERS).map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
        </div>
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
