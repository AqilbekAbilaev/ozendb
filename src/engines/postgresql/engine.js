// PostgreSQL's entry in the engine table (engines/index.js).
import { buildPostgresFields } from './connection/fields.js'
import { listSchemas, tableStats } from './api/resources.js'
import { dialect, api } from './sql.js'

export const postgresql = Object.freeze({
  id: 'postgresql',
  defaultPort: 5432,
  // A PostgreSQL connection names its one database up front.
  namesDatabase: true,
  buildFields: buildPostgresFields,
  loadResources: listSchemas,
  // What the shared SQL tabs (engines/sql) write and call.
  sql: Object.freeze({ dialect, api }),
  // Only table rows open a stats card here.
  statsTip: Object.freeze({
    kind: () => 'pgTable',
    label: (target) => `${target.schema}.${target.table}`,
    read: (target) => tableStats({ connectionId: target.connId, schema: target.schema, table: target.table }),
  }),
})
