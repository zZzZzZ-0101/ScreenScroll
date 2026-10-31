import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from './theme';
import type { Theme } from './settings';

const THEMES: Array<[Theme, string, typeof Sun]> = [
  ['system', 'System', Monitor],
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
];

/** Light, dark or the system's: three labelled choices, saved for every page at once. */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
      {THEMES.map(([t, label, Icon]) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => setTheme(t)}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] focus-visible:outline-2 focus-visible:outline-accent ${theme === t ? 'bg-accent text-white' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white'}`}
        >
          <Icon aria-hidden size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}
