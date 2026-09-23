import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'

// ESLint's recommended rules catch general JavaScript mistakes; Vue's essentials
// cover template correctness. Project-specific rules stay focused on dead code, not
// style — there is still no formatter here, deliberately.
export default [
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.test.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // The layering rule from CLAUDE.md: a ring may import inwards, never outwards.
  // Only the directions that already hold everywhere are enforced — utils' two reaches
  // into appApi and workspaces predate this and are left to be dealt with separately.
  {
    files: ['src/utils/**/*.js'],
    ignores: ['**/*.test.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['**/stores/*', '**/composables/*', '**/components/*', '**/engines/*'],
        message: 'utils/ holds pure functions — no Vue, no I/O, no app state.',
      }] }],
    },
  },
  {
    files: ['src/stores/**/*.js'],
    ignores: ['**/*.test.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['**/composables/*', '**/components/*'],
        message: 'stores/ is imported by composables and components, not the other way round.',
      }] }],
    },
  },
  {
    files: ['src/composables/**/*.js'],
    ignores: ['**/*.test.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['**/components/*'],
        message: 'composables/ is imported by components, not the other way round.',
      }] }],
    },
  },
  {
    rules: {
      // Single-word component names are the convention throughout src/components.
      'vue/multi-word-component-names': 'off',
      // Tabs are plain objects and children mutate their properties directly — see the
      // "Tab state" note in CLAUDE.md. Every hit of this rule is that pattern.
      'vue/no-mutating-props': 'off',
      // Ignored catch bindings and placeholder args are intentional; `_` opts out.
      'no-unused-vars': ['error', {
        caughtErrors: 'none',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Best-effort persistence and optional platform APIs intentionally ignore failures.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The rest were already true of every file when they were turned on, so they cost
      // nothing to keep true. `null: 'ignore'` keeps `== null` as the both-nullish check.
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Diagnostics belong in the error log (utils/errorReport.js), not the console —
      // warn/error stay for the handful of places that report a genuine fault.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'vue/no-unused-refs': 'error',
      'vue/require-default-prop': 'error',
      'vue/require-prop-types': 'error',
      // Catches a prop left behind after its use moved or was relayed away.
      'vue/no-unused-properties': ['error', { groups: ['props'] }],
    },
  },
]
