// MySQL's entry in the engine table (engines/index.js).
import { buildSqlFields } from '../sql/connection/fields.js'

export const mysql = Object.freeze({
  id: 'mysql',
  defaultPort: 3306,
  // The form's database is only the one a session starts in: a MySQL connection reaches
  // every database on the server, so it may be left blank.
  namesDatabase: true,
  buildFields: buildSqlFields,
  // TODO #387: list the server's databases once a MySQL connection can connect (#386).
  loadResources: async () => {
    throw new Error('Browsing a MySQL connection isn’t available yet.')
  },
})
