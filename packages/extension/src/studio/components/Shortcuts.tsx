import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { t } from '@/shared/i18n';

/** Every key the Studio answers to, in one place (opened with ? or the keyboard button). */
const GROUPS: Array<[string, Array<[string, string]>]> = [
  [
    'Everywhere',
    [
      ['Ctrl+S', 'Save PDF'],
      ['Ctrl+Shift+C', 'Copy this page'],
      ['Ctrl+P', 'Print'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Y', 'Redo'],
      ['← →', 'Previous or next page'],
      ['+ − 0', 'Zoom in, out, fit'],
      ['I', 'Details'],
      ['?', 'Keyboard shortcuts'],
    ],
  ],
  [
    'Mark up',
    [
      ['V', 'Select'],
      ['C', 'Crop'],
      ['T', 'Text'],
      ['R', 'Rectangle'],
      ['A', 'Arrow'],
      ['N', 'Step number'],
      ['X', 'Mosaic'],
      ['B', 'Blur'],
      ['Delete', 'Remove the selected mark'],
      ['Esc', 'Deselect'],
    ],
  ],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      onClick={onClose}
      data-testid="shortcuts"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Keyboard shortcuts')}
        className="max-h-[85vh] w-[28rem] max-w-[92vw] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 text-[13px] shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t('Keyboard shortcuts')}</h2>
          <button
            ref={close}
            type="button"
            aria-label={t('Close')}
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800"
          >
            <X aria-hidden size={16} />
          </button>
        </div>
        {GROUPS.map(([group, keys]) => (
          <div key={group} className="pb-2">
            <h3 className="pb-1 text-[12px] font-medium text-neutral-500">{t(group)}</h3>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1">
              {keys.map(([k, what]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-neutral-600 dark:bg-neutral-800">
                      {k}
                    </kbd>
                  </dt>
                  <dd>{t(what)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p className="pt-1 text-[12px] text-neutral-500">
          {t('Starting a capture: Alt+Shift+P (full page), V (visible), S (selection), E (element); change them in the browser’s extension shortcuts.')}
        </p>
      </section>
    </div>
  );
}
