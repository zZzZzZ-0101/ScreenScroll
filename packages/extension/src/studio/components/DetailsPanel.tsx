import { Copy, X } from 'lucide-react';
import { useState } from 'react';
import { detailsText, type Details } from '@/studio/engine/details';

/**
 * Details (header ⓘ): every number behind the pages and how it was calculated, then one
 * line per page. Monospace, dense, copyable.
 */
export function DetailsPanel({ details, onClose }: { details: Details; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(detailsText(details));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const icon =
    'rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-neutral-800 dark:hover:text-white';
  return (
    <aside className="h-full overflow-y-auto p-3 text-[12px]" aria-label="Details">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">Details</h2>
        <div className="flex items-center gap-1">
          <span role="status" className="text-[11px] text-neutral-500">
            {copied ? 'Copied' : ''}
          </span>
          <button
            type="button"
            className={icon}
            onClick={() => void copy()}
            aria-label="Copy all as text"
            title="Copy all as text"
          >
            <Copy aria-hidden size={14} />
          </button>
          <button
            type="button"
            className={icon}
            onClick={onClose}
            aria-label="Close details"
            title="Close details (I)"
          >
            <X aria-hidden size={14} />
          </button>
        </div>
      </div>
      {details.sections.map((s) => (
        <section key={s.title} className="mb-3">
          <h3 className="mb-1 border-b border-neutral-200 pb-0.5 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-700">
            {s.title}
          </h3>
          <dl>
            {s.rows.map((r) => (
              <div key={r.label} className="py-0.5">
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-neutral-500">{r.label}</dt>
                  <dd className="min-w-0 text-right font-mono text-[11px] break-words">
                    {r.value}
                  </dd>
                </div>
                {r.how && (
                  <dd className="font-mono text-[10.5px] leading-snug text-neutral-500">{r.how}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section>
        <h3 className="mb-1 border-b border-neutral-200 pb-0.5 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-700">
          Pages
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[10.5px]" aria-label="Pages">
            <thead className="text-neutral-500">
              <tr>
                <th className="pr-1.5 text-left font-normal">#</th>
                <th className="pr-1.5 text-right font-normal" title="Top and bottom, CSS px">
                  y
                </th>
                <th className="pr-1.5 text-right font-normal" title="Share of T used">
                  fill
                </th>
                <th className="pr-1.5 text-left font-normal">break</th>
                <th className="pr-1.5 text-right font-normal">cost</th>
                <th className="text-right font-normal" title="Page image, px">
                  image
                </th>
              </tr>
            </thead>
            <tbody>
              {details.pages.map((p) => (
                <tr
                  key={p.n}
                  className={p.overlap > 0 ? 'text-amber-700 dark:text-amber-400' : undefined}
                  title={
                    p.overlap > 0 ? `Forced cut, ${Math.round(p.overlap)} px repeated` : undefined
                  }
                >
                  <td className="pr-1.5">{p.n}</td>
                  <td className="pr-1.5 text-right whitespace-nowrap">
                    {Math.round(p.y0)}–{Math.round(p.y1)}
                  </td>
                  <td className="pr-1.5 text-right">{Math.round(p.fill * 100)}%</td>
                  <td className="pr-1.5">{p.breakKind}</td>
                  <td className="pr-1.5 text-right">{p.cost.toFixed(1)}</td>
                  <td className="text-right whitespace-nowrap">
                    {p.imageW}×{p.imageH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </aside>
  );
}
