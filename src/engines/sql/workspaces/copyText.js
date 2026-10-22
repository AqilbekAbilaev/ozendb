import { formatCell } from './formatCell.js'

// What the grid puts on the clipboard. A value copies as the grid shows it, but NULL
// as nothing, as a MongoDB null does.
export const valueText = (value) => (value === null ? '' : formatCell(value))

// Spreadsheet-style quoting, so a value holding a tab, line break or quote pastes as one cell.
const field = (text) => (/[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)

// Rows a line each, values tab-separated: pastes into a spreadsheet as cells.
export const rowsAsTsv = (rows) => rows.map(row => row.map(value => field(valueText(value))).join('\t')).join('\n')

// One row as an object keyed by column, several as a list of them.
export function rowsAsJson(columns, rows) {
  const objects = rows.map(row => Object.fromEntries(columns.map((column, c) => [column, row[c]])))
  return JSON.stringify(objects.length === 1 ? objects[0] : objects, null, 2)
}
