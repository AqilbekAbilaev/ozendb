import pluginVue from 'eslint-plugin-vue'

// Only two rules are on: unused code, and Vue's own parse-level essentials. The point
// is dead code that survives a refactor (a destructure whose template moved away), not
// style — there is still no formatter here, deliberately.
export default [
  ...pluginVue.configs['flat/essential'],
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
    },
  },
]
