// PostgreSQL's entry in the engine table (engines/index.js).
import { buildSqlFields } from '../sql/connection/fields.js'
import { listSchemas, tableStats } from './api/resources.js'
import { postgresSql } from './sql.js'

export const postgresql = Object.freeze({
  id: 'postgresql',
  defaultPort: 5432,
  // A PostgreSQL connection names its one database up front.
  namesDatabase: true,
  buildFields: buildSqlFields,
  loadResources: listSchemas,
  // What the shared SQL tabs (engines/sql) write and call.
  sql: postgresSql,
  // Only table rows open a stats card here.
  statsTip: Object.freeze({
    kind: () => 'pgTable',
    label: (target) => `${target.schema}.${target.table}`,
    read: (target) => tableStats({ connectionId: target.connId, schema: target.schema, table: target.table }),
  }),
})
