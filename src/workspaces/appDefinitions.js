// App-level workspace definitions. The only one is Quickstart: the home
// screen, which needs no resource target and no engine state.
import QuickstartPane from '../components/panes/QuickstartPane.vue'

export const appDefinitions = [
  {
    type: 'app.quickstart',
    engine: 'app',
    component: QuickstartPane,
    // No active tab resolves to this definition too (registry.js), so WorkspaceArea
    // needs the same marker either way: no props, no listeners.
    paneKind: 'quickstart',
    create() {
      return {
        title: 'Quickstart',
        target: null,
        fields: { kind: 'quickstart' },
      }
    },
  },
]
