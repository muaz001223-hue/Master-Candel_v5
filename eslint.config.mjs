// Root ESLint entry: reuses the frontend configuration so lint tools launched from
// the repository root find a flat config. Frontend sources are linted via
// frontend/eslint.config.mjs; archived reference material and build output are ignored.
import frontendConfig from './frontend/eslint.config.mjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'reference/**',
      'test_reports/**',
      'frontend/plugins/**',
      'frontend/public/**',
    ],
  },
  ...frontendConfig.map(entry =>
    entry.files
      ? { ...entry, files: entry.files.map(pattern => `frontend/${pattern}`) }
      : entry,
  ),
  {
    files: ['extensions/**/*.js', 'scripts/**/*.mjs', 'backend/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { chrome: 'readonly', console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', document: 'readonly', window: 'readonly', Date: 'readonly', JSON: 'readonly', Error: 'readonly', Math: 'readonly', Number: 'readonly', Object: 'readonly', Array: 'readonly', Promise: 'readonly', Map: 'readonly', Set: 'readonly', String: 'readonly', Buffer: 'readonly' },
    },
    rules: { 'no-unreachable': 'error', 'no-dupe-args': 'error', 'no-unsafe-finally': 'error', 'valid-typeof': 'error' },
  },
];
