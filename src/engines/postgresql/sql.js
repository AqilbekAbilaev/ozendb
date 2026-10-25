// What the shared SQL tabs (engines/sql) need from PostgreSQL: how its SQL is written,
// the commands they call, how to read its Explain output, and its own windows. Reached
// through the engine table as `engineOf(x).sql`.
import * as queries from './api/queries.js'
import { listColumns, listForeignKeys } from './api/resources.js'
import * as library from '../sql/api/library.js'
import * as transfer from './api/transfer.js'
import { planRows } from './workspaces/planRows.js'
import { saveRows } from './saveRows.js'

// How a column's cells are styled, from its format_type() name. Arrays and JSON show
// as JSON text, so they stay plain whatever their element type.
const KINDS = [
  [/^(smallint|integer|bigint|numeric|decimal|real|double precision|money)\b/, 'num'],
  [/^(text|character|varchar|citext|uuid|name)\b/, 'str'],
  [/^(timestamp|date|time|interval)\b/, 'date'],
  [/^boolean$/, 'bool'],
]

export const dialect = Object.freeze({
  quoteName: (name) => `"${name.replaceAll('"', '""')}"`,
  // Backslashes stay as they are: a PostgreSQL string gives them no meaning. An engine
  // whose strings do (MySQL) doubles them here, which also keeps LIKE's escapes intact.
  quoteText: (text) => `'${text.replaceAll("'", "''")}'`,
  // `pattern` is a LIKE pattern, escaped with backslashes — ILIKE's default escape.
  like: (column, pattern) => `${column}::text ILIKE ${dialect.quoteText(pattern)}`,
  // A filter's value in a comparison, and the text a contains or starts-with matches:
  // as typed, since PostgreSQL reads a quoted value as the column's own type.
  filterLiteral: (value) => dialect.quoteText(value),
  filterText: (value) => value,
  readFilterText: (value) => value,
  // The reader has already folded an unquoted name as PostgreSQL does, so names match exactly.
  sameColumn: (name, written) => name === written,
  // An enum column (one listing its labels) is its own kind, whatever its type's name.
  cellKind(dataType, enumValues) {
    if (enumValues?.length) return 'enum'
    if (!dataType || dataType.endsWith('[]')) return null
    return KINDS.find(([pattern]) => pattern.test(dataType))?.[1] ?? null
  },
  // Arrays are edited as the JSON list the grid shows, json and jsonb as JSON.
  jsonShape(dataType) {
    if (dataType?.endsWith('[]')) return 'list'
    return dataType === 'json' || dataType === 'jsonb' ? 'json' : null
  },
  // PostgreSQL never accepts a value for an identity-always or stored generated column.
  takesValue: (info) => !(info?.identity === 'always' || info?.generated === 'stored'),
  // An identity or serial column numbers a row left without a value: a duplicated row
  // leaves it out, or the copy would repeat its original's number.
  fillsItself: (info) => Boolean(info?.identity) || /^nextval\(/.test(info?.default ?? ''),
  serverSql: "SELECT current_setting('server_version'), current_setting('server_encoding')",
})

export const api = Object.freeze({ ...queries, listColumns, listForeignKeys, ...library, ...transfer, saveRows })

export const postgresSql = Object.freeze({
  dialect,
  api,
  readPlan: planRows,
  // modalRegistry names: exporting a query's rows, and a table's row-edit history.
  modals: Object.freeze({ export: 'sqlExport', rowHistory: 'sqlRowHistory' }),
})
