import { updateRow } from '../api/queries'
import { errMessage } from '../../../utils/errors'
import { formatCell } from './formatCell.js'

const JSON_TYPES = ['json', 'jsonb']

// Editing a table tab's cells, by the row's primary key.
export function useTableEdit(t, readOnly) {
  const { target, rows, editError, refByKey, columnInfo, keyColumns, at } = t
  // Only the browsed table's own cells are editable, by its primary key. Arrays aren't
  // editable yet: their text form (`{a,b}`) isn't what the grid shows.
  function canEdit(key) {
    const ref = refByKey.value[key]
    return !readOnly && keyColumns.value.length > 0 && ref?.table === 0
  }

  // JSON and array columns are edited as JSON — arrays as the list the grid shows.
  const asJson = (column) => {
    const type = columnInfo.value[column]?.dataType ?? ''
    return JSON_TYPES.includes(type) || type.endsWith('[]')
  }

  // The editor's starting text: JSON (so a string keeps its quotes and saving it
  // unchanged parses back) where asJson, everything else as displayed, NULL as empty.
  function editText(column, value) {
    if (value === null) return ''
    return asJson(column) ? JSON.stringify(value) : formatCell(value)
  }

  // `text` null is the editor's Set NULL, never text to parse.
  function parseInput(column, text) {
    if (text === null || !asJson(column)) return text
    const isArray = columnInfo.value[column].dataType.endsWith('[]')
    let value
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error(`"${column}" holds ${isArray ? 'a list' : 'JSON'}, and that isn't valid JSON.`)
    }
    if (isArray && !Array.isArray(value)) throw new Error(`"${column}" holds a list: write it like ["a", "b"].`)
    return value
  }

  async function saveCell(rowIndex, key, text) {
    editError.value = null
    const row = rows.value[rowIndex]
    try {
      const value = parseInput(key, text)
      // The browsed table's columns are keyed by their bare names.
      const where = keyColumns.value.map(name => ({ column: name, value: row[at(name)] }))
      const updated = await updateRow(target, [{ column: refByKey.value[key].name, value }], where)
      if (updated !== 1) {
        editError.value = 'That row changed or was deleted since it was loaded. Refresh and try again.'
        return false
      }
      row[at(key)] = value
      return true
    } catch (e) {
      editError.value = errMessage(e)
      return false
    }
  }

  return { canEdit, editText, saveCell }
}
