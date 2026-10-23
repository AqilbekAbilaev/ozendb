// MySQL's entry in the engine table (engines/index.js).
import { buildSqlFields } from '../sql/connection/fields.js'
import { listDatabases } from './api/resources.js'

export const mysql = Object.freeze({
  id: 'mysql',
  defaultPort: 3306,
  // The form's database is only the one a session starts in: a MySQL connection reaches
  // every database on the server, so it may be left blank.
  namesDatabase: true,
  // How the server section of the connection editor labels that database.
  databaseField: Object.freeze({ label: 'Default database', placeholder: 'optional' }),
  buildFields: buildSqlFields,
  loadResources: listDatabases,
})
