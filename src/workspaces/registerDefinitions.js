// Explicit, ordered registration of every workspace definition (Work 5E). No module
// side effects: main.js calls this once, before Vue mounts and before the tab store's
// initializeTabs() — the explicit ordering is what makes any later createWorkspace
// find its definition. Importing this file pulls in no store module, so the
// registration order cannot create an import cycle.
import { registerWorkspaceDefinition } from './registry'
import { appDefinitions } from './appDefinitions'
import { queryDefinitions } from '../engines/mongodb/workspaces/queryDefinitions'
import { toolDefinitions } from '../engines/mongodb/workspaces/toolDefinitions'

export function registerWorkspaceDefinitions() {
  for (const def of [...appDefinitions, ...queryDefinitions, ...toolDefinitions]) {
    registerWorkspaceDefinition(def)
  }
}