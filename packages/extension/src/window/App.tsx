import { AppWindow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { importImage } from '@/shared/import-image';
import { t } from '@/shared/i18n';

const DELAYS = [0, 3, 5] as const;

/**
 * Capture a window, another app or the whole screen (M7 "browser-window capture"): the
 * browser asks which, ScreenScroll takes one picture, stops sharing at once, and opens it
 * in the Studio like any capture. Nothing is recorded or sent anywhere.
 */
export function App() {
  const [delay, setDelay] = useState<(typeof DELAYS)[number]>(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = `${t('Capture a window')} · ScreenScroll`;
  }, []);

  const choose = async () => {
    setBusy(true);
    setNote(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      for (let s = delay; s > 0; s--) {
        setNote(t('Taking the picture in {n} s…', { n: s }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      // One more frame, so what was shown at the end of the countdown is what is kept.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const c = new OffscreenCanvas(video.videoWidth, video.videoHeight);
      c.getContext('2d')!.drawImage(video, 0, 0);
      stream.getTracks().forEach((tr) => tr.stop());
      stream = null;
      const blob = await c.convertToBlob({ type: 'image/png' });
      const name = `${t('Window')} ${new Date().toLocaleString()}.png`;
      const id = await importImage(new File([blob], name, { type: 'image/png' }));
      location.href = chrome.runtime.getURL(`/studio.html?session=${encodeURIComponent(id)}`);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      setNote(
        err.name === 'NotAllowedError'
          ? t('Nothing was shared, so nothing was captured.')
          : t('The picture could not be taken: {why}', { why: err.message ?? String(e) }),
      );
    } finally {
      stream?.getTracks().forEach((tr) => tr.stop());
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-6 text-sm text-neutral-800 dark:text-neutral-100">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <AppWindow aria-hidden size={20} /> {t('Capture a window')}
      </h1>
      <p className="mt-1 text-neutral-600 dark:text-neutral-300">
        {t(
          'A browser window, another app, or the whole screen: the browser asks which. One picture is taken, sharing stops at once, and it opens in the Studio.',
        )}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span id="delay" className="text-neutral-600 dark:text-neutral-300">
          {t('Wait before the picture')}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="delay"
          className="flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700"
        >
          {DELAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={delay === d}
              aria-label={d ? t('{n} seconds', { n: d }) : t('No timer')}
              onClick={() => setDelay(d)}
              className={`rounded px-2 py-0.5 ${delay === d ? 'bg-neutral-200 font-medium dark:bg-neutral-700' : 'text-neutral-500'}`}
            >
              {d ? `${d}s` : t('Off')}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void choose()}
        className="mt-4 w-full rounded-lg bg-accent px-3 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {t('Choose what to capture')}
      </button>
      {note && (
        <p role="status" className="mt-3 text-neutral-600 dark:text-neutral-300">
          {note}
        </p>
      )}
    </main>
  );
}
