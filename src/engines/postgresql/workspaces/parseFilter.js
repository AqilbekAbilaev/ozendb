// A header filter box's text as `{ op, value }` for the backend, or null when there
// is nothing to apply. `kind` is the column's cellKind: numbers and booleans match
// exactly unless an operator says otherwise, everything else by contains.
const OPERATORS = [['>=', 'gte'], ['<=', 'lte'], ['!=', 'ne'], ['<>', 'ne'], ['>', 'gt'], ['<', 'lt'], ['=', 'eq']]

export function parseFilter(text, kind) {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^null$/i.test(trimmed)) return { op: 'isNull' }
  if (/^!null$/i.test(trimmed)) return { op: 'notNull' }
  const operator = OPERATORS.find(([symbol]) => trimmed.startsWith(symbol))
  if (operator) {
    const value = trimmed.slice(operator[0].length).trim()
    return value ? { op: operator[1], value } : null
  }
  return { op: kind === 'num' || kind === 'bool' ? 'eq' : 'contains', value: trimmed }
}

// The inverse: the box text that types `filter` back, or null when none does
// (a contains on a number column, or a value the box would read as an operator).
export function filterBoxText(filter, kind) {
  const { op, value } = filter
  let text
  if (op === 'isNull') text = 'null'
  else if (op === 'notNull') text = '!null'
  else if (op === 'contains') text = value
  else if (op === 'eq' && (kind === 'num' || kind === 'bool')) text = value
  else text = OPERATORS.find(([, name]) => name === op)[0] + value
  const back = parseFilter(text, kind)
  return back && back.op === op && back.value === value ? text : null
}
