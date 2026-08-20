// Explicit, ordered registration of every workspace definition (Work 5E). No module
// side effects: main.js calls this once, before Vue mounts, so the first
// createWorkspace call — including the tab store's module-scope Quickstart — always
// finds its definition. Importing this file pulls in no store module, so the
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