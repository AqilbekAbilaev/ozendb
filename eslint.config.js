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
    },
  },
]
