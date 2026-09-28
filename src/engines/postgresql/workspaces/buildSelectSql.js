// The SQL a table tab's filters, joins, sort and page amount to, for its SQL mode.
// Values are written as untyped literals, which Postgres reads as the column's own
// type — the same comparison the backend's filter binding makes.
const OPERATORS = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

const ident = (name) => `"${name.replaceAll('"', '""')}"`
const literal = (text) => `'${text.replaceAll("'", "''")}'`
// ILIKE's default escape character is a backslash.
const likeEscape = (text) => text.replace(/[\\%_]/g, '\\$&')
// An any-of filter's values, as the backend splits them.
const listItems = (value) => value.split(',').map(v => v.trim()).filter(Boolean)

function condition(column, { op, value }) {
  if (op === 'isNull') return `${column} IS NULL`
  if (op === 'notNull') return `${column} IS NOT NULL`
  if (op === 'contains') return `${column}::text ILIKE ${literal(`%${likeEscape(value)}%`)}`
  if (op === 'startsWith') return `${column}::text ILIKE ${literal(`${likeEscape(value)}%`)}`
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

// Columns, filters and sort name a column as `{ table, column }`, `table` being 0 for
// the browsed table and 1 and on for `joins` in order; `columns` are the ones to
// show, or empty for all of them. Without joins, columns go unqualified.
export function buildSelectSql({ schema, table, joins = [], columns = [], filters, orderBy, descending, limit, offset }) {
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
  filters.forEach((f, i) => lines.push(`${i ? '  AND' : 'WHERE'} ${condition(col(f), f)}`))
  if (orderBy.length) {
    const direction = descending ? 'DESC' : 'ASC'
    lines.push(`ORDER BY ${orderBy.map(c => `${col(c)} ${direction}`).join(', ')}`)
  }
  lines.push(`LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''};`)
  return lines.join('\n')
}
