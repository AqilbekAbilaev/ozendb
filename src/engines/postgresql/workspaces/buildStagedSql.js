// Multi-line, human-reviewable SQL for the staged-changes preview (ozendb-63t) —
// never bound or executed, only shown in "Preview the SQL a save will run"
// (tableStage.js's reviewSql). Every list that can grow with the table's column
// count (INSERT's columns/values, UPDATE's SET clauses, DELETE's row tuples) goes
// one item per line, comma-joined, the way buildSelectSql.js already lays out a
// SELECT — a wide table's statement stays reviewable instead of scrolling sideways.

export function buildInsertSql(qualified, columns, values) {
  return [
    `INSERT INTO ${qualified} (`,
    columns.join(',\n'),
    ') VALUES (',
    values.join(',\n'),
    ');',
  ].join('\n')
}

export function buildUpdateSql(qualified, setClauses, whereClause) {
  return [
    `UPDATE ${qualified}`,
    `SET ${setClauses.join(',\n')}`,
    `WHERE ${whereClause};`,
  ].join('\n')
}

export function buildDeleteSql(qualified, keyColumns, tuples) {
  return [
    `DELETE FROM ${qualified}`,
    `WHERE (${keyColumns}) IN (`,
    tuples.join(',\n'),
    ');',
  ].join('\n')
}
