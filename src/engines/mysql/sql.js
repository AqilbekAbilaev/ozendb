// What the shared SQL tabs (engines/sql) need from MySQL: how its SQL is written and the
// commands they call. Reached through the engine table as `engineOf(x).sql`.
import * as queries from './api/queries.js'
import * as resources from './api/resources.js'

// How a column's cells are styled, from its COLUMN_TYPE. TINYINT(1), MySQL's BOOLEAN, is
// a number: it holds any small integer, and a filter of `true` would match 0.
const KINDS = [
  [/^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|year)\b/, 'num'],
  [/^(char|varchar|tinytext|text|mediumtext|longtext|set)\b/, 'str'],
  [/^(date|datetime|timestamp|time)\b/, 'date'],
  [/^enum\(/, 'enum'],
]

const quoteText = (text) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`

export const dialect = Object.freeze({
  quoteName: (name) => `\`${name.replaceAll('`', '``')}\``,
  // A MySQL string gives backslashes meaning, so they are doubled, which also keeps
  // LIKE's escapes intact.
  quoteText,
  // `pattern` is a LIKE pattern, escaped with backslashes, LIKE's default. The column is
  // read as text under a case-insensitive collation, so matching ignores case whatever
  // the column's own collation, as the backend's filter does (commands/mysql/browse.rs).
  like: (column, pattern) => `CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_general_ci LIKE ${quoteText(pattern)}`,
  // An ENUM's labels are part of its type name, so it needs no list of its own.
  cellKind: (dataType) => KINDS.find(([pattern]) => pattern.test(dataType ?? ''))?.[1] ?? null,
  jsonShape: (dataType) => (dataType === 'json' ? 'json' : null),
  // TODO #390: refuse a generated column, once list_mysql_columns reports one.
  takesValue: () => true,
  serverSql: 'SELECT VERSION(), @@character_set_server',
})

// Rejects as a failed command would, so the screen shows why.
const notYet = (what) => () => Promise.reject({ code: 'not_available', message: `${what} isn't available for MySQL yet.` })

// The shared table tab names the namespace a table sits in its `schema`; on MySQL, which
// has no schema level, that is the table's database.
const inDatabase = ({ connectionId, schema, table }) => ({ connectionId, database: schema, table })

export const api = Object.freeze({
  browseTable: (target, options) => queries.browseTable(inDatabase(target), options),
  countTable: (target, filters) => queries.countTable(inDatabase(target), filters),
  listColumns: (target) => resources.listColumns(inDatabase(target)),
  // TODO #392: the foreign keys a join is offered on.
  listForeignKeys: notYet('Joining tables'),
  // TODO #391: running SQL, which the table tab's SQL mode, Explain, status line and
  // query library share with the SQL tab.
  runQuery: notYet('Running SQL'),
  cancelQuery: notYet('Running SQL'),
  explainQuery: notYet('Explain'),
  formatQuery: notYet('Formatting SQL'),
  readTableSelect: notYet('Reading SQL back into filters'),
  pushHistory: notYet('Query history'),
  listHistory: notYet('Query history'),
  clearHistory: notYet('Query history'),
  listSaved: notYet('Saved queries'),
  saveQuery: notYet('Saved queries'),
  deleteSaved: notYet('Saved queries'),
  // TODO #390: saving a table's edited, added and deleted rows.
  beginTransaction: notYet('Saving rows'),
  commitTransaction: notYet('Saving rows'),
  rollbackTransaction: notYet('Saving rows'),
  insertRow: notYet('Saving rows'),
  updateRow: notYet('Saving rows'),
  deleteRows: notYet('Saving rows'),
})

export const mysqlSql = Object.freeze({
  dialect,
  api,
  // TODO #391: an Explain reader (readPlan) and an export window; TODO #390: row history.
  modals: Object.freeze({}),
})
