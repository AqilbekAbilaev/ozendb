// The Create Table dialog's column rows, and the request they become. The server has
// the last word on names and types (ddl.rs); this only decides when Create is worth
// pressing, and drops the blank rows a user leaves behind.

// Offered in the type box; any other type the server knows can still be typed.
export const COMMON_TYPES = [
  'bigint', 'integer', 'smallint', 'numeric(10,2)', 'real', 'double precision',
  'text', 'varchar(255)', 'boolean', 'uuid', 'date', 'timestamp', 'timestamptz',
  'jsonb', 'json', 'bytea', 'text[]', 'integer[]',
]

export function newColumn(overrides = {}) {
  return { name: '', dataType: 'text', nullable: true, primaryKey: false, identity: false, ...overrides }
}

// A table almost always starts with a key, so the draft does too.
export function startingColumns() {
  return [newColumn({ name: 'id', dataType: 'bigint', nullable: false, primaryKey: true, identity: true })]
}

const isBlank = (column) => !column.name.trim()

export function tableRequest(schema, name, columns) {
  return {
    schema,
    name: name.trim(),
    columns: columns.filter(c => !isBlank(c)).map(c => ({
      name: c.name.trim(),
      dataType: c.dataType.trim(),
      nullable: c.nullable,
      primaryKey: c.primaryKey,
      identity: c.identity,
    })),
  }
}

// Why Create can't be pressed yet, or null when it can.
export function draftProblem(name, columns) {
  if (!name.trim()) return 'Name the table.'
  const named = columns.filter(c => !isBlank(c))
  if (!named.length) return 'Add at least one column.'
  if (named.some(c => !c.dataType.trim())) return 'Every column needs a type.'
  const names = named.map(c => c.name.trim())
  const repeated = names.find((n, i) => names.indexOf(n) !== i)
  if (repeated) return `Column "${repeated}" is listed twice.`
  return null
}
