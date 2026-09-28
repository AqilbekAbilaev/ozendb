import { parseFilter, filterBoxText } from './parseFilter.js'

// The Query Builder's Where conditions — `{ column, op, value }` rows — are another
// view of the header filter boxes, one per column; these convert between the two.

const LABELS = {
  contains: 'contains', eq: 'is', ne: 'is not', gt: 'greater than', gte: 'at least',
  lt: 'less than', lte: 'at most', isNull: 'is NULL', notNull: 'is not NULL',
  startsWith: 'starts with', in: 'is any of',
}
const COMPARE = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']
const BY_KIND = {
  num: [...COMPARE, 'in'],
  date: ['contains', ...COMPARE, 'in'],
  bool: ['eq'],
  enum: ['eq', 'ne', 'in'],
}

// The operators a column of cellKind `kind` can take, as `{ op, label }`.
export function operatorsFor(kind) {
  return [...(BY_KIND[kind] ?? ['contains', 'startsWith', 'eq', 'ne', 'in']), 'isNull', 'notNull'].map(op => ({ op, label: LABELS[op] }))
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

// The same, with paused conditions (see builderPauses.js): each row carries `on`, and
// paused ones come after the applied ones. A column the grid has filled since shows once.
export function rowsFromParts(texts, paused, kinds) {
  const on = rowsFromBoxes(texts, kinds).map(r => ({ ...r, on: true }))
  const off = rowsFromBoxes(paused, kinds).filter(r => !texts[r.column]?.trim()).map(r => ({ ...r, on: false }))
  return [...on, ...off]
}

export function partsFromRows(rows, kinds) {
  return {
    texts: boxesFromRows(rows.filter(r => r.on), kinds),
    paused: boxesFromRows(rows.filter(r => !r.on), kinds),
  }
}
