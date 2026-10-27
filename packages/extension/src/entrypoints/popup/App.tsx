import { useState } from 'react';

type Mode = 'full' | 'visible';

export function App() {
  const [error, setError] = useState<string | null>(null);

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
