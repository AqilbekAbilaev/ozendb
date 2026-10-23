// MySQL workspace definitions: the shared table tab, opened on a `database/table` ref.
import { tableDefinition } from '../../sql/workspaces/tableDefinition.js'

export const mysqlDefinitions = [tableDefinition('mysql', (opened) => opened.resource)]
