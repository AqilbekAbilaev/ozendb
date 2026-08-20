// App-level workspace definitions (Work 5B). The only one is Quickstart: the home
// screen, which needs no resource target and no engine state.
import { WORKSPACE_COMPONENTS } from './registry'

export const appDefinitions = [
  {
    type: 'app.quickstart',
    engine: 'app',
    component: WORKSPACE_COMPONENTS.quickstart,
    create() {
      return {
        title: 'Quickstart',
        target: null,
        fields: { kind: 'quickstart' },
      }
    },
  },
]