// PostgreSQL's entry in the engine table (engines/index.js).
import { buildSqlFields } from '../sql/connection/fields.js'
import { useSqlFields } from '../sql/connection/useSqlFields.js'
import { listSchemas, tableStats } from './api/resources.js'
import { postgresSql } from './sql.js'
import { postgresqlMenu } from './menu.js'
import { pgTagKey } from '../../utils/tabColor.js'

export const postgresql = Object.freeze({
  id: 'postgresql',
  defaultPort: 5432,
  // How the server section of the connection editor labels the one database a
  // PostgreSQL connection names up front.
  databaseField: Object.freeze({ label: 'Database', placeholder: 'postgres' }),
  // Its own connection-editor fields, beyond the ones every engine shares.
  useFields: useSqlFields,
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
  // Its switches for the native menu (utils/menuContext's deriveMenuContext).
  menu: postgresqlMenu,
  // How a node's colour tag is keyed in the tag store, for the tab bar (utils/tabColor).
  tagKey: pgTagKey,
})
