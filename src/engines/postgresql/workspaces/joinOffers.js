// The joins a table tab can add: for each table already in it (`tables`, as
// `{ key, schema, table }`, the browsed table first with key ''), every table its
// foreign keys link to that isn't in the tab yet. `keysByTable` maps `schema.table`
// to that table's foreign keys, as listForeignKeys returns them. An offer joins
// `schema.table` where its `column` equals the column keyed `equals`.
export function joinOffers(tables, keysByTable) {
  const inTab = new Set(tables.map(t => `${t.schema}.${t.table}`))
  const mainSchema = tables[0].schema
  const offers = []
  for (const { key, schema, table } of tables) {
    for (const fk of keysByTable[`${schema}.${table}`] ?? []) {
      const holdsKey = fk.fromSchema === schema && fk.fromTable === table
      const [other, otherColumn, ownColumn] = holdsKey
        ? [{ schema: fk.toSchema, table: fk.toTable }, fk.toColumn, fk.fromColumn]
        : [{ schema: fk.fromSchema, table: fk.fromTable }, fk.fromColumn, fk.toColumn]
      if (inTab.has(`${other.schema}.${other.table}`)) continue
      const name = other.schema === mainSchema ? other.table : `${other.schema}.${other.table}`
      offers.push({
        ...other,
        column: otherColumn,
        equals: key ? `${key}.${ownColumn}` : ownColumn,
        label: `${name} (linked by ${fk.fromTable}.${fk.fromColumn})`,
      })
    }
  }
  return offers
}
