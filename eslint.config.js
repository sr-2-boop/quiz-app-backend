import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Untrusted code never runs in the API process (CLAUDE.md hard rule 7).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:vm', message: 'Never execute code in the API process; use the SandboxClient.' },
            { name: 'vm', message: 'Never execute code in the API process; use the SandboxClient.' },
            { name: 'node:child_process', message: 'Never execute code in the API process; use the SandboxClient.' },
            { name: 'child_process', message: 'Never execute code in the API process; use the SandboxClient.' },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
