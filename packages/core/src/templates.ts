/* Header/footer templates (PDF_OUTPUT §4): plain data, no pdf-lib, so settings code in the
 * service worker can use them. */

/** Left / centre / right texts of one band, with tokens (PDF_OUTPUT §4). */
export interface BandTemplate {
  left: string;
  center: string;
  right: string;
}

export const EMPTY_BAND: BandTemplate = { left: '', center: '', right: '' };
export const DEFAULT_FOOTER: BandTemplate = {
  left: '{domain} · {date}',
  center: '',
  right: '{page}/{pages}',
};

export interface BandTokens {
  title: string;
  url: string;
  domain: string;
  date: string;
  time: string;
  page: number;
  pages: number;
}

export function fillTemplate(template: string, t: BandTokens): string {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in t ? String(t[k as keyof BandTokens]) : m))
    .trim();
}

export function bandTokens(
  meta: { title: string; url: string; capturedAt: Date },
  page: number,
  pages: number,
): BandTokens {
  let domain = '';
  try {
    domain = new URL(meta.url).hostname.replace(/^www\./, '');
  } catch {
    // Imported files have no URL.
  }
  const d = meta.capturedAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    title: meta.title,
    url: meta.url,
    domain,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    page,
    pages,
  };
}
