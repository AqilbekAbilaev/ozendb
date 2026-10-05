// Multi-line, human-reviewable SQL for the staged-changes preview (#165, #164) —
// never bound or executed, only shown in "Preview the SQL a save will run"
// (tableStage.js's reviewSql). Every list that can grow with the table's column
// count (INSERT's columns/values, UPDATE's SET clauses, DELETE's row tuples) goes
// one item per line, indented under its clause the way buildSelectSql.js indents
// its continuation lines — a wide table's statement stays reviewable instead of
// scrolling sideways.

// Only each item's first line is indented: a multi-line string literal must read
// exactly as it will be stored.
const list = (items) => items.map(item => `  ${item}`).join(',\n')

export function buildInsertSql(qualified, columns, values) {
  return [
    `INSERT INTO ${qualified} (`,
    list(columns),
    ') VALUES (',
    list(values),
    ');',
  ].join('\n')
}

export function buildUpdateSql(qualified, setClauses, whereClause) {
  return [
    `UPDATE ${qualified}`,
    'SET',
    list(setClauses),
    `WHERE ${whereClause};`,
  ].join('\n')
}

export function buildDeleteSql(qualified, keyColumns, tuples) {
  return [
    `DELETE FROM ${qualified}`,
    `WHERE (${keyColumns}) IN (`,
    list(tuples),
    ');',
  ].join('\n')
}
