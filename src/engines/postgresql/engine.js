// PostgreSQL's entry in the engine table (engines/index.js).
import { buildPostgresFields } from './connection/fields.js'
import { listSchemas, tableStats } from './api/resources.js'

export const postgresql = Object.freeze({
  id: 'postgresql',
  defaultPort: 5432,
  // A PostgreSQL connection names its one database up front.
  namesDatabase: true,
  buildFields: buildPostgresFields,
  loadResources: listSchemas,
  // Only table rows open a stats card here.
  statsTip: Object.freeze({
    kind: () => 'pgTable',
    label: (target) => `${target.schema}.${target.table}`,
    read: (target) => tableStats({ connectionId: target.connId, schema: target.schema, table: target.table }),
  }),
})
