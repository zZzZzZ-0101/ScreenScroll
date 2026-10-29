import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const NETWORK = 'ScreenScroll is offline: no network requests (CLAUDE.md constraint 1).';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
      '**/.wxt/**',
      'test-results/**',
      'playwright-report/**',
      'docs/reference/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: NETWORK },
        { name: 'XMLHttpRequest', message: NETWORK },
        { name: 'WebSocket', message: NETWORK },
        { name: 'EventSource', message: NETWORK },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: NETWORK },
      ],
    },
  },
  {
    // The one exception to "no network" (DECISIONS 2026-10-29): the OCR worker fetches the
    // model files the user asked for, from the engine descriptor's address only.
    files: ['packages/extension/src/ocr/ocr-worker.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['packages/extension/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
        browser: 'readonly',
      },
    },
  },
);
