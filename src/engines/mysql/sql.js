// What the shared SQL tabs (engines/sql) need from MySQL: how its SQL is written and the
// commands they call. Reached through the engine table as `engineOf(x).sql`.
import * as queries from './api/queries.js'
import * as resources from './api/resources.js'

// How a column's cells are styled and filtered, from its COLUMN_TYPE. TINYINT(1), MySQL's
// BOOLEAN, is a number: it can hold any small integer, though its 0 and 1 show as false
// and true (and filter `true` as 1); BIT reads as the number its bits make
// (commands/mysql/cell.rs).
const KINDS = [
  [/^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|year|bit)\b/, 'num'],
  [/^(char|varchar|tinytext|text|mediumtext|longtext|set)\b/, 'str'],
  [/^(date|datetime|timestamp|time)\b/, 'date'],
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
  // An enum column (one listing its labels) is its own kind, as on PostgreSQL.
  cellKind(dataType, enumValues) {
    if (enumValues?.length) return 'enum'
    return KINDS.find(([pattern]) => pattern.test(dataType ?? ''))?.[1] ?? null
  },
  jsonShape: (dataType) => (dataType === 'json' ? 'json' : null),
  // MySQL refuses a value for a generated column. An auto-increment one takes a value, or
  // numbers the row itself when left blank, as PostgreSQL's by-default identity does.
  takesValue: (info) => !info?.generated,
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
  // SQL mode's transactions (runSql.js), part of running SQL.
  beginTransaction: notYet('Running SQL'),
  commitTransaction: notYet('Running SQL'),
  rollbackTransaction: notYet('Running SQL'),
  saveRows: (target, changes) => queries.saveRows(inDatabase(target), changes),
})

export const mysqlSql = Object.freeze({
  dialect,
  api,
  // TODO #391: an Explain reader (readPlan) and an export window. TODO (follow-up to
  // #390, issue not yet filed): a row-history window, once saves record history.
  modals: Object.freeze({}),
})
