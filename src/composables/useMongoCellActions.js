import { computed, markRaw, ref } from 'vue'
import { replaceDocument } from '../engines/mongodb/api/documents'
import { runFind } from '../engines/mongodb/api/queries'
import { valueToClipboard } from '../utils/clipboardCopy'
import { dbRefOf, idFilterString } from '../utils/dbRef'
import { errText } from '../utils/errors'
import { formatCell, guessType } from '../utils/resultGrid'

// What a MongoDB grid's cells do beyond being clicked (see useGridCells): drill into a
// nested value, follow a DBRef, copy a value / document / selection, and edit in place.
// `cells` is the grid's useGridCells; `selectedCol` its useRowSelection's. `holder` is
// where results and selection live (a MongoDB tab's runtime); the tab itself when omitted.
export function useMongoCellActions({
  activeTab,
  holder = activeTab,
  drillPath,
  readonly,
  gridDocs,
  selectedCol,
  cells,
  emit,
}) {
  const { cellCtx } = cells
  const inlineEdit = ref(null)

  function openCellDrill(rowIdx, col) {
    const tab = activeTab()
    if (!tab) return
    const value = gridDocs()[rowIdx]?.[col]
    if (guessType(col, value) !== 'obj') return
    emit('update:drillPath', [...drillPath(), col])
    selectedCol.value = null
    holder().selectedRow = -1
  }

  function goToDrillLevel(level) {
    const path = drillPath()
    emit('update:drillPath', level < 0 ? [] : path.slice(0, level + 1))
    selectedCol.value = null
    const tab = activeTab()
    if (tab) holder().selectedRow = -1
  }

  function copySelectedCell() {
    const tab = activeTab()
    if (!tab || holder().selectedRow < 0 || !selectedCol.value) return
    const value = gridDocs()[holder().selectedRow]?.[selectedCol.value]
    navigator.clipboard.writeText(valueToClipboard(value))
  }

  function copySelectedDocument() {
    const tab = activeTab()
    if (!tab || holder().selectedRow < 0) return
    navigator.clipboard.writeText(JSON.stringify(holder().results[holder().selectedRow], null, 2))
  }

  function copySelection() {
    const tab = activeTab()
    if (!tab) return
    const rows = holder().selectedRows?.length
      ? holder().selectedRows
      : (holder().selectedRow >= 0 ? [holder().selectedRow] : [])
    if (!rows.length) return
    if (rows.length === 1) {
      selectedCol.value ? copySelectedCell() : copySelectedDocument()
      return
    }
    const documents = rows.map((index) => holder().results[index]).filter((doc) => doc != null)
    navigator.clipboard.writeText(JSON.stringify(documents, null, 2))
  }

  function cellCtxPick(action) {
    const documents = gridDocs()
    const value = documents[cellCtx.value?.row]?.[cellCtx.value?.col]
    if (action === 'follow-reference') return followReference()
    if (action === 'copy-value') {
      navigator.clipboard.writeText(valueToClipboard(value))
    } else if (action === 'copy-json') {
      navigator.clipboard.writeText(JSON.stringify(value, null, 2))
    } else if (action === 'copy-doc') {
      navigator.clipboard.writeText(JSON.stringify(documents[cellCtx.value.row], null, 2))
    }
    cellCtx.value = null
  }

  const cellRef = computed(() => {
    if (!cellCtx.value) return null
    const value = gridDocs()[cellCtx.value.row]?.[cellCtx.value.col]
    return dbRefOf(value)
  })

  const cellMenuItems = computed(() => [
    ...(cellRef.value
      ? [{ label: `Follow Reference → ${cellRef.value.ref}`, value: 'follow-reference', icon: 'aggregate' }, { sep: true }]
      : []),
    { label: 'Copy Value', value: 'copy-value', icon: 'copy', shortcut: '⌘C' },
    { label: 'Copy as JSON', value: 'copy-json' },
    { sep: true },
    { label: 'Copy Document', value: 'copy-doc' },
  ])

  function followReference() {
    const reference = cellRef.value
    const tab = activeTab()
    if (!reference || !tab) {
      cellCtx.value = null
      return
    }
    emit('follow-reference', {
      connectionId: tab.connectionId,
      connectionName: tab.connectionName,
      dbName: reference.db || tab.dbName,
      collectionName: reference.ref,
      filter: idFilterString(reference.id),
    })
    cellCtx.value = null
  }

  function startInlineEdit(rowIdx, col) {
    if (readonly()) return
    const tab = activeTab()
    if (!tab) return
    const value = gridDocs()[rowIdx]?.[col]
    const type = guessType(col, value)
    if (type === 'obj' || type === 'id') return
    inlineEdit.value = { rowIdx, col, raw: formatCell(col, value) }
  }

  function editedValue(edit, originalValue) {
    const type = guessType(edit.col, originalValue)
    if (type === 'num') {
      const number = Number(edit.raw)
      return isNaN(number) ? edit.raw : number
    }
    if (type === 'bool') return edit.raw === 'true'
    if (type === 'date') return { $date: edit.raw }
    if (type === 'decimal') return { $numberDecimal: edit.raw }
    return edit.raw
  }

  function idFilter(document) {
    return JSON.stringify({ _id: document._id })
  }

  async function commitInlineEdit() {
    const edit = inlineEdit.value
    if (!edit) return
    inlineEdit.value = null
    const tab = activeTab()
    if (!tab) return

    const rootDocument = JSON.parse(JSON.stringify(holder().results[edit.rowIdx]))
    let target = rootDocument
    for (const key of drillPath()) target = target[key]
    target[edit.col] = editedValue(edit, gridDocs()[edit.rowIdx]?.[edit.col])
    const filter = idFilter(holder().results[edit.rowIdx])

    try {
      await replaceDocument(
        { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
        filter,
        JSON.stringify(rootDocument),
      )
      const { documents } = await runFind(
        { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
        { filter, projection: '{}', sort: '{}', skip: 0, limit: 1 },
      )
      if (documents.length) holder().results.splice(edit.rowIdx, 1, markRaw(documents[0]))
      else holder().results.splice(edit.rowIdx, 1)
    } catch (error) {
      emit('crud-error', errText(error))
    }
  }

  function cancelInlineEdit() {
    inlineEdit.value = null
  }

  return {
    inlineEdit,
    cellMenuItems,
    copySelection,
    cellCtxPick,
    startInlineEdit,
    commitInlineEdit,
    cancelInlineEdit,
    openCellDrill,
    goToDrillLevel,
  }
}
