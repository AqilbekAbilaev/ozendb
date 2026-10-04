// What the CSV import dialog shows and sends (ozendb-6v3). The mapping holds one target
// column per CSV header; SKIP (a select can't hold null) leaves a header out.

export const SKIP = ''

export function columnOptions(columns) {
  return [
    { value: SKIP, label: '— skip —' },
    ...columns
      .filter(c => !c.generated)
      .map(c => ({ value: c.name, label: `${c.name} (${c.dataType}${!c.nullable && !c.hasDefault ? ', required' : ''})` })),
  ]
}

export const toSelections = (mapping) => mapping.map(m => m ?? SKIP)
export const toMapping = (selections) => selections.map(s => (s === SKIP ? null : s))
export const mappedCount = (mapping) => mapping.filter(m => m != null && m !== SKIP).length

export function importedMessage(rows) {
  return `Imported ${rows.toLocaleString('en-US')} row${rows === 1 ? '' : 's'}`
}
