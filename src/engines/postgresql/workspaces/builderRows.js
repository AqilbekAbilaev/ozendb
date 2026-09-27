import { parseFilter, filterBoxText } from './parseFilter.js'

// The Query Builder's Where conditions — `{ column, op, value }` rows — are another
// view of the header filter boxes, one per column; these convert between the two.

const LABELS = {
  contains: 'contains', eq: 'is', ne: 'is not', gt: 'greater than', gte: 'at least',
  lt: 'less than', lte: 'at most', isNull: 'is NULL', notNull: 'is not NULL',
}
const COMPARE = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']
const BY_KIND = {
  num: COMPARE,
  date: ['contains', ...COMPARE],
  bool: ['eq'],
}

// The operators a column of cellKind `kind` can take, as `{ op, label }`.
export function operatorsFor(kind) {
  return [...(BY_KIND[kind] ?? ['contains', 'eq', 'ne']), 'isNull', 'notNull'].map(op => ({ op, label: LABELS[op] }))
}

export function rowsFromBoxes(texts, kinds) {
  return Object.entries(texts).flatMap(([column, text]) => {
    const filter = parseFilter(text, kinds[column])
    return filter ? [{ column, op: filter.op, value: filter.value ?? '' }] : []
  })
}

export function boxesFromRows(rows, kinds) {
  const texts = {}
  for (const { column, op, value } of rows) {
    const needsValue = op !== 'isNull' && op !== 'notNull'
    if (needsValue && !value.trim()) continue
    const text = filterBoxText(needsValue ? { op, value: value.trim() } : { op }, kinds[column])
    if (text != null) texts[column] = text
  }
  return texts
}
