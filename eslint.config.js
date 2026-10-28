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
      'reference/**',
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
