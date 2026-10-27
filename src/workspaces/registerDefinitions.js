// Explicit, ordered registration of every workspace definition. No module
// side effects: main.js calls this once, before Vue mounts and before the tab store's
// initializeTabs() — the explicit ordering is what makes any later createWorkspace
// find its definition. Importing this file pulls in no store module, so the
// registration order cannot create an import cycle.
import { registerWorkspaceDefinition } from './registry'
import { appDefinitions } from './appDefinitions'
import { ENGINE_DEFINITIONS } from '../engines/workspaces'

export function registerWorkspaceDefinitions() {
  for (const def of [...appDefinitions, ...ENGINE_DEFINITIONS]) {
    registerWorkspaceDefinition(def)
  }
}