import { ChevronDown, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type ExportFormat = 'pdf' | 'pdf-long' | 'png' | 'jpeg' | 'webp' | 'long-png';

type Item =
  | { kind: 'format'; format: ExportFormat; label: string }
  | { kind: 'action'; id: 'copy' | 'print'; label: string; keys: string };

const ITEMS: Item[] = [
  { kind: 'format', format: 'pdf-long', label: 'PDF as one long page' },
  { kind: 'format', format: 'png', label: 'Pages as PNG images (zip)' },
  { kind: 'format', format: 'jpeg', label: 'Pages as JPEG images (zip)' },
  { kind: 'format', format: 'webp', label: 'Pages as WebP images (zip)' },
  { kind: 'format', format: 'long-png', label: 'One long image (PNG)' },
  { kind: 'action', id: 'copy', label: 'Copy this page', keys: 'Ctrl+Shift+C' },
  { kind: 'action', id: 'print', label: 'Print', keys: 'Ctrl+P' },
];

/**
 * The one button that matters (Save PDF), with every other output one click away instead
 * of behind a format picker.
 */
export function SaveMenu(p: {
  disabled: boolean;
  onExport: (f: ExportFormat) => void;
  onCopy: () => void;
  onPrint: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [open]);

  const choose = (item: Item) => {
    setOpen(false);
    if (item.kind === 'format') p.onExport(item.format);
    else if (item.id === 'copy') p.onCopy();
    else p.onPrint();
  };

  return (
    <div ref={root} className="relative flex">
      <button
        type="button"
        onClick={() => p.onExport('pdf')}
        disabled={p.disabled}
        title="Save PDF (Ctrl+S)"
        className="flex items-center gap-1.5 rounded-l-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        <Download aria-hidden size={15} />
        Save PDF
      </button>
      <button
        type="button"
        aria-label="More ways to save"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={p.disabled}
        onClick={() => setOpen(!open)}
        className="rounded-r-md border-l border-white/30 bg-accent px-1.5 text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        <ChevronDown aria-hidden size={15} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Save as"
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-neutral-200 bg-white py-1 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
          onKeyDown={(e) => {
            const i = items.current.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') {
              setOpen(false);
              (root.current?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = ITEMS.length;
              items.current[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
            }
          }}
        >
          {ITEMS.map((item, i) => (
            <div key={item.label}>
              {i === 5 && (
                <div
                  role="separator"
                  className="my-1 border-t border-neutral-200 dark:border-neutral-700"
                />
              )}
              <button
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitem"
                onClick={() => choose(item)}
                className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800"
              >
                {item.label}
                {item.kind === 'action' && (
                  <kbd className="font-sans text-neutral-500">{item.keys}</kbd>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
