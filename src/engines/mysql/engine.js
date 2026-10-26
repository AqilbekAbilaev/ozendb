// MySQL's entry in the engine table (engines/index.js).
import { buildSqlFields } from '../sql/connection/fields.js'
import { useSqlFields } from '../sql/connection/useSqlFields.js'
import { listDatabases } from './api/resources.js'
import { mysqlSql } from './sql.js'

export const mysql = Object.freeze({
  id: 'mysql',
  defaultPort: 3306,
  // How the server section of the connection editor labels its database. That is only
  // the one a session starts in: a MySQL connection reaches every database on the
  // server, so it may be left blank.
  databaseField: Object.freeze({ label: 'Default database', placeholder: 'optional' }),
  // Its own connection-editor fields, beyond the ones every engine shares.
  useFields: useSqlFields,
  buildFields: buildSqlFields,
  loadResources: listDatabases,
  // What the shared SQL tabs (engines/sql) write and call.
  sql: mysqlSql,
})
