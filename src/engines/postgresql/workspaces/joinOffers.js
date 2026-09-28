// The joins a table tab can add: for each table already in it (`tables`, as
// `{ key, schema, table }`, the browsed table first with key ''), every table its
// foreign keys link to that isn't in the tab yet. `keysByTable` maps `schema.table`
// to that table's foreign keys, as listForeignKeys returns them. An offer joins
// `schema.table` where each pair in `on` holds: its `column` equals the column keyed
// `equals` — one pair per column of the key.
export function joinOffers(tables, keysByTable) {
  const inTab = new Set(tables.map(t => `${t.schema}.${t.table}`))
  const mainSchema = tables[0].schema
  const offers = []
  for (const { key, schema, table } of tables) {
    for (const fk of keysByTable[`${schema}.${table}`] ?? []) {
      const holdsKey = fk.fromSchema === schema && fk.fromTable === table
      const [other, otherColumns, ownColumns] = holdsKey
        ? [{ schema: fk.toSchema, table: fk.toTable }, fk.toColumns, fk.fromColumns]
        : [{ schema: fk.fromSchema, table: fk.fromTable }, fk.fromColumns, fk.toColumns]
      if (inTab.has(`${other.schema}.${other.table}`)) continue
      const name = other.schema === mainSchema ? other.table : `${other.schema}.${other.table}`
      offers.push({
        ...other,
        on: otherColumns.map((column, i) => ({ column, equals: key ? `${key}.${ownColumns[i]}` : ownColumns[i] })),
        label: `${name} (linked by ${fk.fromTable}.${fk.fromColumns.join(', ')})`,
      })
    }
  }
  return offers
}
