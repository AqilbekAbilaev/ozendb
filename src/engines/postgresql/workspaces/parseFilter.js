// A header filter box's text as `{ op, value }` for the backend, or null when there
// is nothing to apply. `kind` is the column's cellKind: numbers, booleans and enums match
// exactly unless an operator says otherwise, everything else by contains. `^abc` is
// starts with; a comma list where the box would match exactly (`1, 2`, `=a, b`) is any
// of — a comma in a text search stays part of the text.
const OPERATORS = [['>=', 'gte'], ['<=', 'lte'], ['!=', 'ne'], ['<>', 'ne'], ['>', 'gt'], ['<', 'lt'], ['=', 'eq']]
const EXACT_KINDS = ['num', 'bool', 'enum']

export function parseFilter(text, kind) {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return { op: 'isNull' }
  if (/^!null$/i.test(trimmed)) return { op: 'notNull' }
  if (trimmed.startsWith('^')) {
    const value = trimmed.slice(1).trim()
    return value ? { op: 'startsWith', value } : null
  }
  const operator = OPERATORS.find(([symbol]) => trimmed.startsWith(symbol))
  const op = operator?.[1] ?? (EXACT_KINDS.includes(kind) ? 'eq' : 'contains')
  const value = operator ? trimmed.slice(operator[0].length).trim() : trimmed
  if (!value) return null
  return { op: op === 'eq' && value.includes(',') ? 'in' : op, value }
}

// The inverse: the box text that types `filter` back, or null when none does
// (a contains on a number column, or a value the box would read as an operator).
export function filterBoxText(filter, kind) {
  const { op, value } = filter
  let text
  if (op === 'isNull') text = 'null'
  else if (op === 'notNull') text = '!null'
  else if (op === 'contains') text = value
  else if (op === 'startsWith') text = '^' + value
  else if ((op === 'eq' || op === 'in') && EXACT_KINDS.includes(kind)) text = value
  else if (op === 'in') text = '=' + value
  else text = OPERATORS.find(([, name]) => name === op)[0] + value
  const back = parseFilter(text, kind)
  return back && back.op === op && back.value === value ? text : null
}
