// Every column a table tab can show, in the order the browse returns them: the
// browsed table's, then each join's. A column is known by `key` — its bare name for
// the browsed table, `<join key>.<name>` for a join — and sent to the backend as
// `{ table, column }`, where `table` is its position (0 for the browsed table).
// `tables` is `[{ key, columns: [columnInfo…] }]`, the browsed table first with key ''.
export function columnRefs(tables) {
  return tables.flatMap(({ key: prefix, columns }, table) =>
    columns.map(info => ({ key: prefix ? `${prefix}.${info.name}` : info.name, table, name: info.name, info })))
}
