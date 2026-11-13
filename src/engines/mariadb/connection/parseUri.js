// A mariadb:// connection string as the connection editor's fields. MariaDB's clients
// also accept mysql://, so both schemes are read, with the rest as MySQL reads it.
import { mysqlUriOptions } from '../../mysql/connection/parseUri.js'
import { parseSqlUri } from '../../sql/connection/parseUri.js'

export function parseMariaDbUri(raw) {
  return parseSqlUri(raw, { ...mysqlUriOptions, schemes: ['mariadb', 'mysql'] })
}
