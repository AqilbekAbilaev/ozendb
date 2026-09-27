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
