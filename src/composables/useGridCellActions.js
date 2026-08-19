import { computed, markRaw, ref } from 'vue'
import { replaceDocument } from '../engines/mongodb/api/documents'
import { runFind } from '../engines/mongodb/api/queries'
import { valueToClipboard } from '../utils/clipboardCopy'
import { dbRefOf, idFilterString } from '../utils/dbRef'
import { errText } from '../utils/errors'
import { formatCell, guessType } from '../utils/resultGrid'

export function useGridCellActions({
  activeTab,
  drillPath,
  readonly,
  gridDocs,
  selectedCol,
  suppressNextClick,
  setSingleRow,
  selectRangeTo,
  toggleRow,
  applyRowGesture,
  emit,
}) {
  const cellCtx = ref(null)
  const inlineEdit = ref(null)

  function onCellClick(event, rowIdx, col) {
    if (suppressNextClick.value) {
      suppressNextClick.value = false
      return
    }
    if (event.shiftKey) selectRangeTo(rowIdx)
    else if (event.metaKey || event.ctrlKey) toggleRow(rowIdx)
    else {
      selectCell(rowIdx, col)
      return
    }
    selectedCol.value = null
    cellCtx.value = null
  }

  function selectRow(event, rowIdx) {
    applyRowGesture(event, rowIdx)
    selectedCol.value = null
    cellCtx.value = null
  }

  function selectCell(rowIdx, col) {
    setSingleRow(rowIdx)
    selectedCol.value = col
    cellCtx.value = null
  }

  function openCellDrill(rowIdx, col) {
    const tab = activeTab()
    if (!tab) return
    const value = gridDocs()[rowIdx]?.[col]
    if (guessType(col, value) !== 'obj') return
    emit('update:drillPath', [...drillPath(), col])
    selectedCol.value = null
    tab.selectedRow = -1
  }

  function goToDrillLevel(level) {
    const path = drillPath()
    emit('update:drillPath', level < 0 ? [] : path.slice(0, level + 1))
    selectedCol.value = null
    const tab = activeTab()
    if (tab) tab.selectedRow = -1
  }

  function copySelectedCell() {
    const tab = activeTab()
    if (!tab || tab.selectedRow < 0 || !selectedCol.value) return
    const value = gridDocs()[tab.selectedRow]?.[selectedCol.value]
    navigator.clipboard.writeText(valueToClipboard(value))
  }

  function copySelectedDocument() {
    const tab = activeTab()
    if (!tab || tab.selectedRow < 0) return
    navigator.clipboard.writeText(JSON.stringify(tab.results[tab.selectedRow], null, 2))
  }

  function copySelection() {
    const tab = activeTab()
    if (!tab) return
    const rows = tab.selectedRows?.length
      ? tab.selectedRows
      : (tab.selectedRow >= 0 ? [tab.selectedRow] : [])
    if (!rows.length) return
    if (rows.length === 1) {
      selectedCol.value ? copySelectedCell() : copySelectedDocument()
      return
    }
    const documents = rows.map((index) => tab.results[index]).filter((doc) => doc != null)
    navigator.clipboard.writeText(JSON.stringify(documents, null, 2))
  }

  function openCellCtx(event, rowIdx, col) {
    event.preventDefault()
    selectCell(rowIdx, col)
    cellCtx.value = { x: event.clientX, y: event.clientY, row: rowIdx, col }
  }

  function cellCtxPick(action) {
    const documents = gridDocs()
    const value = documents[cellCtx.value?.row]?.[cellCtx.value?.col]
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

    const rootDocument = JSON.parse(JSON.stringify(tab.results[edit.rowIdx]))
    let target = rootDocument
    for (const key of drillPath()) target = target[key]
    target[edit.col] = editedValue(edit, gridDocs()[edit.rowIdx]?.[edit.col])
    const filter = idFilter(tab.results[edit.rowIdx])

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
      if (documents.length) tab.results.splice(edit.rowIdx, 1, markRaw(documents[0]))
      else tab.results.splice(edit.rowIdx, 1)
    } catch (error) {
      emit('crud-error', errText(error))
    }
  }

  function cancelInlineEdit() {
    inlineEdit.value = null
  }

  return {
    cellCtx,
    inlineEdit,
    cellRef,
    copySelection,
    openCellCtx,
    cellCtxPick,
    followReference,
    startInlineEdit,
    commitInlineEdit,
    cancelInlineEdit,
    onCellClick,
    selectRow,
    selectCell,
    openCellDrill,
    goToDrillLevel,
  }
}
