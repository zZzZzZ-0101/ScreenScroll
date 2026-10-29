import { RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/shared/settings';
import {
  defaultOf,
  labelOf,
  SECTIONS,
  SETTINGS,
  type SettingEntry,
} from '@/shared/settings-schema';
import { DEFAULT_ENGINE } from '@screenscroll/core/ocr';
import { downloadModel } from '@/ocr/client';
import { modelStatus, removeModel, type ModelStatus } from '@/ocr/store';

/**
 * Settings (UI §6): every option with a plain explanation, its default and the value we
 * recommend. Changes save at once; "Reset" puts a setting (or all of them) back.
 */
export function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [undo, setUndo] = useState<Settings | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Settings · ScreenScroll';
    void loadSettings().then(setS);
  }, []);

  if (!s) return null;

  const apply = async (patch: Partial<Settings>) => {
    // Sharp capture needs the debugger permission; ask while the click still counts as a
    // user gesture, and keep Standard if it is refused.
    if (patch.capture && patch.capture.resolution !== 'standard') {
      const ok = await chrome.permissions.request({ permissions: ['debugger'] }).catch(() => false);
      if (!ok) {
        setNote('Sharp capture needs the permission; it stays at Standard.');
        return;
      }
    }
    setNote(null);
    const next = { ...s, ...patch };
    setS(next);
    void saveSettings(patch);
  };
  const resetAll = () => {
    setUndo(s);
    setS(DEFAULT_SETTINGS);
    void saveSettings(DEFAULT_SETTINGS);
    setTimeout(() => setUndo(null), 8000);
  };
  const changed = SETTINGS.filter((e) => e.get(s) !== defaultOf(e)).length;

  return (
    <main className="mx-auto max-w-3xl p-6 text-[13px] text-neutral-900 dark:text-neutral-100">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-neutral-500">
            Changes save at once. Each setting shows its default and what we recommend.
          </p>
        </div>
        <button
          type="button"
          disabled={!changed}
          onClick={resetAll}
          className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <RotateCcw aria-hidden size={14} /> Reset all{changed ? ` (${changed})` : ''}
        </button>
      </div>

      {note && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {note}
        </p>
      )}

      {SECTIONS.map((section) => (
        <section key={section} aria-label={section} className="mt-5">
          <h2 className="pb-2 text-sm font-semibold">{section}</h2>
          <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
            {SETTINGS.filter((e) => e.section === section).map((e) => (
              <Row key={e.id} entry={e} settings={s} onChange={(p) => void apply(p)} />
            ))}
            {section === 'Text recognition' && <OcrModelRow />}
          </div>
        </section>
      ))}

      <section
        aria-label="Privacy"
        className="mt-5 flex gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <ShieldCheck aria-hidden size={18} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-neutral-600 dark:text-neutral-300">
          ScreenScroll never sends your data anywhere. Captures, text recognition and PDFs are made
          on this computer. The one connection it can make is downloading the text recognition
          model, once, when you ask; nothing of yours is sent.
        </p>
      </section>

      <p className="mt-4 text-neutral-500">
        Keyboard shortcuts:{' '}
        <button
          type="button"
          className="text-accent underline-offset-2 hover:underline"
          onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        >
          change them in the browser
        </button>
        .
      </p>

      {undo && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md bg-neutral-900 px-3 py-2 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900"
        >
          All settings are back to their defaults.
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => {
              setS(undo);
              void saveSettings(undo);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </main>
  );
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Settings → Text recognition: the model, kept on this computer, downloaded on request. */
function OcrModelRow() {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    void modelStatus(DEFAULT_ENGINE)
      .then(setStatus)
      .catch(() => setStatus(null));
  useEffect(refresh, []);
  const get = async () => {
    setError(null);
    setProgress({ done: 0, total: 1 });
    try {
      await downloadModel((done, total) => setProgress({ done, total }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      refresh();
    }
  };
  const remove = async () => {
    await removeModel(DEFAULT_ENGINE);
    refresh();
  };
  const e = DEFAULT_ENGINE;
  return (
    <div className="p-3" role="group" aria-label="Text recognition model">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Model: {e.name}</p>
          <p className="text-[12px] text-neutral-500">
            {e.languages}. {e.license}. Kept on this computer; downloaded once from{' '}
            <span className="font-mono">{e.baseUrls.map((u) => new URL(u).host).join(' or ')}</span>{' '}
            and checked (SHA-256).
          </p>
        </div>
        {status?.ready ? (
          <button type="button" className={`${control} shrink-0`} onClick={() => void remove()}>
            Remove ({mb(status.stored)})
          </button>
        ) : progress ? null : (
          <button type="button" className={`${control} shrink-0`} onClick={() => void get()}>
            Download ({mb(status?.total ?? 0)})
          </button>
        )}
      </div>
      <p role="status" className="pt-1 text-[12px] text-neutral-600 dark:text-neutral-300">
        {progress
          ? `Downloading ${mb(progress.done)} of ${mb(progress.total)}`
          : status?.ready
            ? 'Ready.'
            : 'Not downloaded. Pages without text of their own stay unsearchable until it is.'}
      </p>
      {error && (
        <p role="alert" className="pt-1 text-[12px] text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent dark:border-neutral-700 dark:bg-neutral-900';

function Row({
  entry: e,
  settings: s,
  onChange,
}: {
  entry: SettingEntry;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const value = e.get(s);
  const def = defaultOf(e);
  const set = (v: string | number | boolean) => onChange(e.set(s, v));
  const id = `set-${e.id}`;
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]" data-testid={id}>
      <div>
        <label
          htmlFor={e.kind === 'choice' && (e.choices?.length ?? 0) <= 4 ? undefined : id}
          id={`${id}-label`}
          className="font-medium"
        >
          {e.label}
        </label>
        <p className="text-neutral-500">{e.help}</p>
        <p className="pt-0.5 text-[12px] text-neutral-500">
          Default: {labelOf(e, def)} · Recommended: {labelOf(e, e.recommended)}
          {e.why ? ` — ${e.why}` : ''}
          {value !== def && (
            <>
              {' · '}
              <button
                type="button"
                className="text-accent underline-offset-2 hover:underline"
                onClick={() => set(def)}
              >
                Reset
              </button>
            </>
          )}
          {value !== e.recommended && (
            <>
              {' · '}
              <button
                type="button"
                className="text-accent underline-offset-2 hover:underline"
                onClick={() => set(e.recommended)}
              >
                Use recommended
              </button>
            </>
          )}
        </p>
      </div>
      <div className="self-center">
        {e.kind === 'toggle' ? (
          <input
            id={id}
            type="checkbox"
            aria-labelledby={`${id}-label`}
            checked={!!value}
            onChange={(ev) => set(ev.target.checked)}
            className="h-4 w-4 accent-[#0e7c7b]"
          />
        ) : e.kind === 'number' ? (
          <span className="flex items-center gap-1">
            <input
              id={id}
              type="number"
              min={e.min}
              max={e.max}
              value={Number(value)}
              onChange={(ev) => set(Number(ev.target.value))}
              className={`${control} w-20`}
            />
            {e.unit}
          </span>
        ) : e.kind === 'text' ? (
          <input
            id={id}
            value={String(value)}
            onChange={(ev) => set(ev.target.value)}
            className={`${control} w-64`}
          />
        ) : (e.choices?.length ?? 0) <= 4 ? (
          <div
            role="radiogroup"
            aria-labelledby={`${id}-label`}
            className="flex flex-wrap rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
          >
            {e.choices!.map((c) => (
              <button
                key={String(c.value)}
                type="button"
                role="radio"
                aria-checked={value === c.value}
                onClick={() => set(c.value)}
                className={`rounded px-2 py-0.5 focus-visible:outline-2 focus-visible:outline-accent ${value === c.value ? 'bg-accent font-medium text-white' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'}`}
              >
                {c.label}
                {c.value === e.recommended && <span className="sr-only"> (recommended)</span>}
              </button>
            ))}
          </div>
        ) : (
          <select
            id={id}
            value={String(value)}
            onChange={(ev) => set(ev.target.value)}
            className={control}
          >
            {e.choices!.map((c) => (
              <option key={String(c.value)} value={String(c.value)}>
                {c.label}
                {c.value === e.recommended ? ' (recommended)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
