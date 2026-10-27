// The SQL a table tab's filters, joins, sort and page amount to, for its SQL mode,
// written in `dialect` (engineOf(x).sql.dialect). Each value is written by the dialect
// for its column's `dataType`, so the server compares it as the backend's filter does.
const OPERATORS = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

// LIKE's escape character is a backslash.
const likeEscape = (text) => text.replace(/[\\%_]/g, '\\$&')
// An any-of filter's values, as the backend splits them.
const listItems = (value) => value.split(',').map(v => v.trim()).filter(Boolean)

function condition(dialect, column, { op, value, dataType }) {
  const literal = (text) => dialect.filterLiteral(text, dataType)
  if (op === 'isNull') return `${column} IS NULL`
  if (op === 'notNull') return `${column} IS NOT NULL`
  if (op === 'contains') return dialect.like(column, `%${likeEscape(dialect.filterText(value, dataType))}%`)
  if (op === 'startsWith') return dialect.like(column, `${likeEscape(dialect.filterText(value, dataType))}%`)
  if (op === 'in') return `${column} IN (${listItems(value).map(literal).join(', ')})`
  return `${column} ${OPERATORS[op]} ${literal(value)}`
}

// Each table's name in the query: its own, or with a suffix when it's already taken
// (a table joined to itself).
export function aliases(names) {
  const seen = {}
  return names.map(name => {
    seen[name] = (seen[name] ?? 0) + 1
    return seen[name] > 1 ? `${name}_${seen[name]}` : name
  })
}

// Each table's primary key columns in turn, as `{ table, column }`; `tables` holds each
// table's columns, the browsed table's first.
export const tableKeys = (tables) =>
  tables.flatMap((columns, table) => columns.filter(c => c.isPrimaryKey).map(c => ({ table, column: c.name })))

// The order a page is read in, as the backend's browse sorts it: `chosen` (or nothing),
// then each of `keys` it isn't, so rows that tie on it still come in one order (#425).
export const pageOrder = (chosen, keys) =>
  (chosen ? [chosen, ...keys.filter(k => k.table !== chosen.table || k.column !== chosen.column)] : keys)

// Columns, filters and sort name a column as `{ table, column }` (a filter also carries
// its column's `dataType`), `table` being 0 for
// the browsed table and 1 and on for `joins` in order; `columns` are the ones to
// show, or empty for all of them. Without joins, columns go unqualified.
export function buildSelectSql(dialect, { schema, table, joins = [], columns = [], filters, orderBy, descending, limit, offset }) {
  const ident = dialect.quoteName
  const names = aliases([table, ...joins.map(j => j.table)])
  const col = ({ table: t = 0, column }) => (joins.length ? `${ident(names[t])}.${ident(column)}` : ident(column))
  const from = (s, t, i) => `${ident(s)}.${ident(t)}${names[i] === t ? '' : ` AS ${ident(names[i])}`}`

  const all = joins.length ? names.map(n => `${ident(n)}.*`).join(', ') : '*'
  const lines = [`SELECT ${columns.length ? columns.map(col).join(', ') : all}`, `FROM ${from(schema, table, 0)}`]
  joins.forEach((j, i) => {
    const kind = j.kind === 'inner' ? 'JOIN' : 'LEFT JOIN'
    const on = j.on.map(p => `${col({ table: i + 1, column: p.column })} = ${col(p.equals)}`).join(' AND ')
    lines.push(`${kind} ${from(j.schema, j.table, i + 1)} ON ${on}`)
  })
  filters.forEach((f, i) => lines.push(`${i ? '  AND' : 'WHERE'} ${condition(dialect, col(f), f)}`))
  if (orderBy.length) {
    const direction = descending ? 'DESC' : 'ASC'
    lines.push(`ORDER BY ${orderBy.map(c => `${col(c)} ${direction}`).join(', ')}`)
  }
  lines.push(`LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''};`)
  return lines.join('\n')
}
