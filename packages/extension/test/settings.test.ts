import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESETS,
  DEFAULT_SETTINGS,
  MAX_PRESETS,
  labelName,
  normalizeSettings,
} from '../src/shared/settings';

describe('stored settings', () => {
  it.each([undefined, null, 'garbage', 42, [], [1, 2], {}])('%j falls back to defaults', (v) => {
    expect(normalizeSettings(v)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and drops broken ones one by one', () => {
    const s = normalizeSettings({
      page: {
        paper: 'Letter',
        orientation: 'sideways',
        marginsMm: { top: -5, right: 20, bottom: 'x', left: 1e9 },
      },
      crop: 'off',
      breakStyle: 7,
      exportPreset: 'gif',
      filenameTemplate: 12,
      afterCapture: 'pdf',
      pdf: {
        textLayer: 'yes',
        links: false,
        header: { left: '{title}', center: 3 },
        footer: 'nope',
      },
    });
    expect(s.page.paper).toBe('Letter');
    expect(s.page.orientation).toBe('portrait');
    expect(s.page.marginsMm).toEqual({ top: 10, right: 20, bottom: 10, left: 10 });
    expect(s.crop).toBe('off');
    expect(s.breakStyle).toBe(1);
    expect(s.exportPreset).toBe('balanced');
    expect(s.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
    expect(s.afterCapture).toBe('pdf');
    expect(s.pdf.textLayer).toBe(true);
    expect(s.pdf.links).toBe(false);
    expect(s.pdf.header).toEqual({ left: '{title}', center: '', right: '' });
    expect(s.pdf.footer).toEqual(DEFAULT_SETTINGS.pdf.footer);
  });

  it('rejects unknown papers and NaN', () => {
    expect(normalizeSettings({ page: { paper: 'A99' } }).page.paper).toBe('A4');
    expect(normalizeSettings({ page: { paper: { w: 0, h: 5 } } }).page.paper).toBe('A4');
    expect(normalizeSettings({ page: { paper: { w: 200, h: 300 } } }).page.paper).toEqual({
      w: 200,
      h: 300,
    });
    expect(normalizeSettings({ breakStyle: Number.NaN }).breakStyle).toBe(0.5);
  });

  it('is idempotent', () => {
    const once = normalizeSettings({ crop: 'off', pdf: { outline: false } });
    expect(normalizeSettings(once)).toEqual(once);
  });

  it('presets: defaults when missing; the user’s own list kept, cleaned and capped', () => {
    expect(normalizeSettings({}).presets).toEqual(DEFAULT_PRESETS);
    const p = normalizeSettings({
      presets: {
        watermarks: ['MINE', '', '  ', 'MINE', 7, 'DRAFT'],
        labels: [
          { name: 'Mine', band: { left: '{date}', center: '', right: 'x' } },
          { name: 'Empty', band: { left: '', center: ' ', right: '' } },
          { name: '', band: { left: 'a', center: '', right: '' } },
          'junk',
        ],
      },
    }).presets;
    expect(p.watermarks).toEqual(['MINE', 'DRAFT']);
    expect(p.labels).toEqual([{ name: 'Mine', band: { left: '{date}', center: '', right: 'x' } }]);
    // Deleting every default is allowed and stays deleted.
    expect(normalizeSettings({ presets: { watermarks: [], labels: [] } }).presets).toEqual({
      watermarks: [],
      labels: [],
    });
    const many = Array.from({ length: 100 }, (_, i) => `W${i}`);
    expect(
      normalizeSettings({ presets: { watermarks: many, labels: [] } }).presets.watermarks,
    ).toHaveLength(MAX_PRESETS);
  });

  it('label preset names come from their content', () => {
    expect(labelName({ left: '{date}', center: '', right: '{page}/{pages}' })).toBe(
      '{date} | {page}/{pages}',
    );
    expect(labelName({ left: ' ', center: '', right: '' })).toBe('');
  });
});
