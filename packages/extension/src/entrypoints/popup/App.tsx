import { useEffect, useState } from 'react';
import { PAPERS, type PaperId } from '@scrollpress/core';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';

type Mode = 'full' | 'visible';

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
  const update = async (patch: Partial<Settings>) => setSettings(await saveSettings(patch));

  async function capture(mode: Mode) {
    setError(null);
    const res = (await chrome.runtime.sendMessage({ type: 'sp:popup-capture', mode })) as {
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
      <button
        type="button"
        onClick={() => void capture('visible')}
        className="mt-1 flex w-full justify-between rounded-md px-3 py-2 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
      >
        <span>Visible area</span>
        <kbd className="font-sans text-neutral-500">Alt+Shift+V</kbd>
      </button>
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
