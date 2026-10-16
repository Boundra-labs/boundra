import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/coverage/**',
      'contracts/out/**',
      'contracts/cache/**',
      'tmp/**',
      'evaluation/reports/**',
      'playwright-report/**',
      'test-results/**',
      'apps/web/next-env.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    // Benchmark integrity (PRD §11.1): hidden persona labels must never reach mandate generators.
    files: ['evaluation/src/baselines/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../fixtures',
              importNames: [
                'Persona',
                'HiddenPreferences',
                'Fixture',
                'loadFixture',
                'fixtureSchema',
              ],
              message: 'Baselines may only use PublicPersona.',
            },
          ],
          patterns: [
            {
              group: ['**/simulator', '**/runner/*'],
              message: 'Hidden labels must not reach mandate generators.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { module: 'readonly', require: 'readonly' } },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeEach: 'readonly',
      },
    },
  },
);
