// The SQL a table tab's filters, sort and page amount to, for its SQL mode. Values
// are written as untyped literals, which Postgres reads as the column's own type —
// the same comparison the backend's filter binding makes.
const OPERATORS = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

const ident = (name) => `"${name.replaceAll('"', '""')}"`
const literal = (text) => `'${text.replaceAll("'", "''")}'`
// ILIKE's default escape character is a backslash.
const likeEscape = (text) => text.replace(/[\\%_]/g, '\\$&')

function condition({ column, op, value }) {
  if (op === 'isNull') return `${ident(column)} IS NULL`
  if (op === 'notNull') return `${ident(column)} IS NOT NULL`
  if (op === 'contains') return `${ident(column)}::text ILIKE ${literal(`%${likeEscape(value)}%`)}`
  return `${ident(column)} ${OPERATORS[op]} ${literal(value)}`
}

export function buildSelectSql({ schema, table, filters, orderBy, descending, limit, offset }) {
  const lines = ['SELECT *', `FROM ${ident(schema)}.${ident(table)}`]
  filters.forEach((f, i) => lines.push(`${i ? '  AND' : 'WHERE'} ${condition(f)}`))
  if (orderBy.length) {
    const direction = descending ? 'DESC' : 'ASC'
    lines.push(`ORDER BY ${orderBy.map(c => `${ident(c)} ${direction}`).join(', ')}`)
  }
  lines.push(`LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''};`)
  return lines.join('\n')
}
