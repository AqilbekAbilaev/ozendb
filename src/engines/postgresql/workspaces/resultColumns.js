// The grid knows a column by a key of its own (PostgresResultGrid), but a query can return
// one name twice (`SELECT a.id, b.id`). Each repeat is keyed `id_2`, `id_3`… — never a key
// the query itself returned — and keeps its name for the header.
export function resultColumns(names) {
  const taken = new Set(names)
  const seen = new Set()
  const keys = names.map((name) => {
    if (!seen.has(name)) {
      seen.add(name)
      return name
    }
    let n = 2
    while (taken.has(`${name}_${n}`)) n++
    taken.add(`${name}_${n}`)
    return `${name}_${n}`
  })
  const info = Object.fromEntries(keys.flatMap((key, i) => (key === names[i] ? [] : [[key, { name: names[i] }]])))
  return { keys, info }
}
