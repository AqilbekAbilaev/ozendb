// Each engine's workspace definitions, which workspaces/registerDefinitions.js registers
// after the app's own. Kept apart from engines/ui.js so registering them pulls in no more
// than the definitions themselves do (see registerDefinitions.js).
import { queryDefinitions } from './mongodb/workspaces/queryDefinitions'
import { toolDefinitions } from './mongodb/workspaces/toolDefinitions'
import { postgresDefinitions } from './postgresql/workspaces/postgresDefinitions'
import { mysqlDefinitions } from './mysql/workspaces/mysqlDefinitions'

export const ENGINE_DEFINITIONS = Object.freeze([...queryDefinitions, ...toolDefinitions, ...postgresDefinitions, ...mysqlDefinitions])
