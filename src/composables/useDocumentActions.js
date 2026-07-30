import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText } from '../utils/errors'
import { inspectField, setFieldValue, addFieldValue, removeField, renameField, getContainer } from '../utils/docEdit'
import { valueToClipboard, valueToEjson, documentToClipboard, fieldPath } from '../utils/clipboardCopy'

// Document CRUD + field-edit + native Document/Collection menu dispatch for the results
// grid. UI-agnostic: `activeTab`/`docMenuRequest` are getters onto ResultsPanel's props,
// `viewMode` is the shared view ref the menu's View items flip, and `showToast`/`requery`
// are injected callbacks (ResultsPanel forwards them to its `toast`/`requery` emits).
export function useDocumentActions({ activeTab, docMenuRequest, viewMode, showToast, requery }) {
  // ── drill into nested object cells ─────────────────────
  // field-name path navigated into, e.g. ['bank_account', 'account']. Owned here
  // (not in ResultTable) so it survives switching to the JSON / Explain view and back,
  // and so the run-reset below has a stable place to live.
  const drillPath = ref([])

  // The parent's run pipeline no longer clears the drill path directly; reset it on the
  // rising edge of isRunning so every fresh run (refresh, pagination, query bar) starts
  // at the top level. The grid shows its loading skeleton while isRunning, so the reset
  // is never visible mid-flight.
  watch(() => { const tab = activeTab(); return tab && tab.isRunning }, (running, prev) => {
    if (running && !prev) drillPath.value = []
  })

  // Reset the drill path when switching tabs so the new collection opens at top level.
  watch(() => activeTab()?.id, () => { drillPath.value = [] })

  // ── document CRUD ──────────────────────────────────────
  const showDeleteConfirm = ref(false)
  const crudError        = ref(null)

  // Open the new-document pop-out window (Rust open_document_window, mode 'insert') — the
  // same window kind as View/Edit, seeded with an empty skeleton. Replaced the in-app
  // insert modal.
  function openInsert() {
    const tab = activeTab()
    if (!tab || tab.kind !== 'collection' || !tab.collectionName) {
      showToast('Open a collection first')
      return
    }
    const target = {
      connId: tab.connectionId,
      db: tab.dbName,
      coll: tab.collectionName,
      idFilter: '',
      label: '',
      mode: 'insert',
    }
    invoke('open_document_window', { target: target })
  }

  // Open the selected document in the pop-out edit window. Reached from the results
  // toolbar pen, Cmd/Ctrl+J, and Document → Edit Document (JSON)…. Edit, View, and Insert
  // all now run in the pop-out document window; the former in-app modals were retired.
  function openEdit() {
    const doc = selectedDoc()
    if (!doc) { showToast('Select a document in the results first'); return }
    openDocumentWindow(activeTab(), doc, 'edit')
  }

  // Open the selected document in a read-only display window. Reached from the results
  // toolbar eye and Document → View Document (JSON)…. Unlike edit, each call opens its
  // own window (see open_document_window's 'view' mode).
  function openView() {
    const doc = selectedDoc()
    if (!doc) { showToast('Select a document in the results first'); return }
    openDocumentWindow(activeTab(), doc, 'view')
  }

  function buildIdFilter(doc) {
    return JSON.stringify({ _id: doc._id })
  }

  // Pop the selected document into a document window (Rust open_document_window). `mode`
  // is 'edit' (the single reusable editor window) or 'view' (an unlimited read-only
  // display window).
  function openDocumentWindow(tab, doc, mode) {
    const target = {
      connId: tab.connectionId,
      db: tab.dbName,
      coll: tab.collectionName,
      idFilter: buildIdFilter(doc),
      label: (doc._id !== null && typeof doc._id === 'object')
        ? JSON.stringify(doc._id)
        : String(doc._id),
      mode: mode,
    }
    invoke('open_document_window', { target: target })
  }

  // Indices of the current row selection (multi-select), falling back to the single active
  // row. Empty when nothing is selected. Shared by the toolbar Copy and Delete actions.
  function selectedRowIndices(tab) {
    if (!tab) return []
    if (tab.selectedRows && tab.selectedRows.length) return tab.selectedRows
    return (tab.selectedRow ?? -1) >= 0 ? [tab.selectedRow] : []
  }

  // How many documents Copy/Delete will act on — drives the delete-confirm wording.
  const selectedCount = computed(() => selectedRowIndices(activeTab()).length)

  // ── copy document (toolbar button) ─────────────────────
  // One selected row copies its document; multiple copy a JSON array (mirrors the grid's
  // Ctrl+C so the toolbar button and the shortcut agree).
  function copySelectedDocument() {
    const tab = activeTab()
    const docs = selectedRowIndices(tab).map((i) => tab.results[i]).filter((d) => d != null)
    if (!docs.length) return
    const payload = docs.length === 1 ? docs[0] : docs
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
  }

  async function onDeleteConfirm() {
    const tab = activeTab()
    const rows = selectedRowIndices(tab)
    if (!rows.length) return
    crudError.value = null
    try {
      if (rows.length === 1) {
        await invoke('delete_document', {
          id: tab.connectionId,
          database: tab.dbName,
          collection: tab.collectionName,
          idFilter: buildIdFilter(tab.results[rows[0]]),
        })
      } else {
        // Bulk delete via a single { _id: { $in: [...] } } filter. The _id values are
        // already in the same Extended-JSON shape buildIdFilter relies on.
        const ids = rows.map((i) => tab.results[i]).filter((d) => d != null).map((d) => d._id)
        await invoke('delete_many', {
          id: tab.connectionId,
          database: tab.dbName,
          collection: tab.collectionName,
          filter: JSON.stringify({ _id: { $in: ids } }),
        })
      }
      showDeleteConfirm.value = false
      tab.selectedRow = -1
      tab.selectedRows = []
      requery(true)
    } catch (e) {
      crudError.value = errText(e)
    }
  }

  // ── Document / Collection menu editors ─────────────────
  // Field-level edits (Edit Value/Type, Add Field, Remove Field, Rename Field), the
  // read-only JSON view, and the collection-wide Update/Delete/Clear dialogs. Field
  // ops operate on the selected row's document at the current drill path, sent through
  // the same replace_document command the inline cell editor uses.
  const fieldEdit        = ref(null)   // { mode:'edit'|'add'|'rename', fieldName, initialType, initialRaw }
  const fieldEditError   = ref(null)
  const removeFieldName  = ref(null)   // field pending remove-confirm
  const removeFieldError = ref(null)
  const showUpdateDialog = ref(false)
  const showDeleteDialog = ref(false)
  const showClearConfirm = ref(false)
  const pasteConfirm     = ref(null)   // { text, id, database, collection } | null — pending paste
  const pasteBusy        = ref(false)
  const clearConfirmText = ref('')
  const clearBusy        = ref(false)
  const clearError       = ref(null)

  // The currently selected document, or null when no row is selected / out of range.
  function selectedDoc() {
    const tab = activeTab()
    if (!tab || (tab.selectedRow ?? -1) < 0) return null
    return tab.results?.[tab.selectedRow] ?? null
  }

  // Dispatch a native Document/Collection menu action onto this panel. The menu gates
  // guarantee the prerequisites (active collection / selected row / selected field);
  // we re-check defensively and guide the user if the selection changed meanwhile.
  function runDocMenuAction(action) {
    const tab = activeTab()
    if (!tab || tab.kind !== 'collection') return

    // Collection-wide actions — no row selection required.
    switch (action) {
      case 'coll:insert_document': openInsert(); return
      case 'coll:update_dialog':   showUpdateDialog.value = true; return
      case 'coll:delete_dialog':   showDeleteDialog.value = true; return
      case 'edit:paste_documents': pasteDocuments(); return
      // View → results view mode (mirrors the in-panel view picker).
      case 'view:table': viewMode.value = 'table'; return
      case 'view:tree':  viewMode.value = 'tree';  return
      case 'view:json':  viewMode.value = 'json';  return
      // View → Refresh Document: re-run the current query to refresh the results.
      case 'view:refresh_document': requery(true); return
      // View → Step Out: pop one drill level (the results grid is field-path based).
      case 'view:step_out':
        if (drillPath.value.length) {
          drillPath.value = drillPath.value.slice(0, -1)
        } else {
          showToast('Already at the top level')
        }
        return
      // View → Step Into Column / Cell: drill into the selected field if it holds an
      // object/array. Both step by field name in this field-path-based grid.
      case 'view:step_column':
      case 'view:step_cell': {
        const stepDoc = selectedDoc()
        const stepField = tab.selectedField
        if (!stepDoc || !stepField) { showToast('Select a cell to step into'); return }
        const stepVal = selectedFieldValue(stepDoc)
        if (stepVal === null || typeof stepVal !== 'object') {
          showToast('Selected cell is not an object or array')
          return
        }
        drillPath.value = [...drillPath.value, stepField]
        tab.selectedRow = -1
        tab.selectedField = null
        return
      }
      case 'coll:clear':
        clearConfirmText.value = ''
        clearError.value = null
        showClearConfirm.value = true
        return
    }

    const doc = selectedDoc()
    if (!doc) { showToast('Select a document in the results first'); return }

    // Whole-document actions.
    switch (action) {
      // Pop the selected document into a window. 'view' opens an unlimited read-only
      // display window; 'edit' (Cmd/Ctrl+J) opens the single reusable editor window,
      // which retargets when fired again on a different document.
      case 'doc:view_json': openDocumentWindow(tab, doc, 'view'); return
      case 'doc:edit_json': openDocumentWindow(tab, doc, 'edit'); return
      case 'doc:delete':    crudError.value = null; showDeleteConfirm.value = true; return
      case 'doc:add_field':
        fieldEditError.value = null
        fieldEdit.value = { mode: 'add', fieldName: '', initialType: 'String', initialRaw: '' }
        return
      // Edit → Copy Document: the whole selected document as pretty Extended JSON.
      case 'edit:copy_document':
        writeClipboard(documentToClipboard(doc), 'Document copied')
        return
      // Edit → Copy: context-appropriate — the selected cell's value if a cell is
      // selected, otherwise the whole document (mirrors the grid's Ctrl+C).
      case 'edit:copy':
        if (tab.selectedField) {
          writeClipboard(valueToClipboard(selectedFieldValue(doc)), 'Copied')
        } else {
          writeClipboard(documentToClipboard(doc), 'Copied')
        }
        return
    }

    // Field-level actions — need a selected field.
    const field = tab.selectedField
    if (!field) { showToast('Select a field (click a cell) first'); return }

    // Field-level copies are read-only, so they're allowed on any field including _id
    // (unlike the edits below, which _id blocks).
    switch (action) {
      case 'edit:copy_value':
        writeClipboard(valueToEjson(selectedFieldValue(doc)), 'Value copied')
        return
      case 'edit:copy_field':
        writeClipboard(field, 'Field name copied')
        return
      case 'edit:copy_field_path':
        writeClipboard(fieldPath(drillPath.value, field), 'Field path copied')
        return
    }

    // The _id field can't be changed: replace_document preserves the original _id, so
    // editing/removing/renaming it would be a silent no-op. Block it here, matching the
    // inline cell editor, which already refuses to edit _id (ResultTable guessType 'id').
    if (field === '_id') { showToast('The _id field cannot be edited'); return }
    switch (action) {
      case 'doc:edit_value': {
        const info = inspectField(doc, drillPath.value, field)
        fieldEditError.value = null
        fieldEdit.value = { mode: 'edit', fieldName: field, initialType: info.type, initialRaw: info.raw }
        return
      }
      case 'doc:rename_field':
        fieldEditError.value = null
        fieldEdit.value = { mode: 'rename', fieldName: field, initialType: 'String', initialRaw: '' }
        return
      case 'doc:remove_field':
        removeFieldError.value = null
        removeFieldName.value = field
        return
    }
  }

  watch(() => docMenuRequest() && docMenuRequest().nonce, (nonce) => {
    if (nonce == null) return
    runDocMenuAction(docMenuRequest().action)
  })

  // The selected cell's value: the field on the container at the current drill path.
  // (When not drilled the container is the document root.) Returns undefined if the
  // path/field no longer resolves.
  function selectedFieldValue(doc) {
    const container = getContainer(doc, drillPath.value)
    if (container === null || typeof container !== 'object') return undefined
    return container[activeTab().selectedField]
  }

  // Put `text` on the system clipboard and confirm with a toast, or report failure.
  function writeClipboard(text, okMessage) {
    navigator.clipboard.writeText(text ?? '')
      .then(() => showToast(okMessage))
      .catch(() => showToast('Copy to clipboard failed'))
  }

  // Edit → Paste Document(s) / Ctrl+V in the grid: read the clipboard and ask for
  // confirmation before inserting — a paste writes to the collection, and the clipboard
  // may hold something the user never meant to send. The read goes through the backend
  // because `navigator.clipboard.readText` is blocked under WebKitGTK on Linux, same as
  // the import pane. The target is captured here so a tab switch mid-dialog can't
  // redirect the insert.
  async function pasteDocuments() {
    const tab = activeTab()
    if (!tab || tab.kind !== 'collection' || !tab.collectionName) {
      showToast('Open a collection first')
      return
    }
    let text
    try {
      text = await invoke('read_clipboard_text')
    } catch (e) {
      showToast('Cannot read from clipboard')
      return
    }
    if (!text || !text.trim()) {
      showToast('Clipboard is empty')
      return
    }
    pasteConfirm.value = {
      text: text,
      id: tab.connectionId,
      database: tab.dbName,
      collection: tab.collectionName,
    }
  }

  // Confirmed paste: insert and refresh. Parse/insert errors surface as a toast (the
  // backend validates the Extended JSON), so a bad paste never crashes.
  async function onPasteConfirm() {
    const target = pasteConfirm.value
    if (!target || pasteBusy.value) return
    // The dialog stays up, disabled, until the insert returns — closing it first would
    // leave a large paste running with nothing on screen to say so.
    pasteBusy.value = true
    try {
      const count = await invoke('insert_documents', {
        id: target.id,
        database: target.database,
        collection: target.collection,
        documents: target.text,
      })
      showToast(`Pasted ${count} document${count !== 1 ? 's' : ''}`)
      requery(true)
    } catch (e) {
      showToast(errText(e))
    } finally {
      pasteBusy.value = false
      pasteConfirm.value = null
    }
  }

  // Persist a field-op mutation of the selected document via replace_document, then
  // refresh the page so the grid reflects it.
  async function saveDocReplacement(newDoc, original) {
    const tab = activeTab()
    await invoke('replace_document', {
      id: tab.connectionId,
      database: tab.dbName,
      collection: tab.collectionName,
      idFilter: buildIdFilter(original),
      document: JSON.stringify(newDoc),
    })
    requery(true)
  }

  async function onFieldEditSave(payload) {
    const tab = activeTab()
    const doc = selectedDoc()
    if (!doc || !fieldEdit.value) { fieldEdit.value = null; return }
    fieldEditError.value = null
    try {
      const mode = fieldEdit.value.mode
      let newDoc
      if (mode === 'edit') {
        newDoc = setFieldValue(doc, drillPath.value, payload.name, payload.value)
      } else if (mode === 'add') {
        newDoc = addFieldValue(doc, drillPath.value, payload.name, payload.value)
      } else {
        newDoc = renameField(doc, drillPath.value, fieldEdit.value.fieldName, payload.name)
      }
      await saveDocReplacement(newDoc, doc)
      fieldEdit.value = null
      tab.selectedField = null
    } catch (e) {
      fieldEditError.value = errText(e)
    }
  }

  async function onRemoveFieldConfirm() {
    const tab = activeTab()
    const doc = selectedDoc()
    const field = removeFieldName.value
    if (!doc || !field) { removeFieldName.value = null; return }
    removeFieldError.value = null
    try {
      const newDoc = removeField(doc, drillPath.value, field)
      await saveDocReplacement(newDoc, doc)
      removeFieldName.value = null
      tab.selectedField = null
    } catch (e) {
      removeFieldError.value = errText(e)
    }
  }

  async function onClearConfirm() {
    const tab = activeTab()
    if (clearConfirmText.value !== tab.collectionName) return
    clearError.value = null
    clearBusy.value = true
    try {
      const removed = await invoke('clear_collection', {
        id: tab.connectionId,
        database: tab.dbName,
        collection: tab.collectionName,
      })
      showClearConfirm.value = false
      tab.selectedRow = -1
      tab.selectedField = null
      showToast(`Cleared ${removed} document${removed !== 1 ? 's' : ''} from ${tab.collectionName}`)
      requery(true)
    } catch (e) {
      clearError.value = errText(e)
    } finally {
      clearBusy.value = false
    }
  }

  function onUpdateDialogDone(message) {
    showUpdateDialog.value = false
    showToast(message)
    requery(true)
  }

  function onDeleteDialogDone(message) {
    const tab = activeTab()
    showDeleteDialog.value = false
    tab.selectedRow = -1
    tab.selectedField = null
    showToast(message)
    requery(true)
  }

  return {
    drillPath: drillPath,
    showDeleteConfirm: showDeleteConfirm,
    selectedCount: selectedCount,
    crudError: crudError,
    openInsert: openInsert,
    openEdit: openEdit,
    openView: openView,
    copySelectedDocument: copySelectedDocument,
    pasteDocuments: pasteDocuments,
    pasteConfirm: pasteConfirm,
    pasteBusy: pasteBusy,
    onPasteConfirm: onPasteConfirm,
    onDeleteConfirm: onDeleteConfirm,
    fieldEdit: fieldEdit,
    fieldEditError: fieldEditError,
    removeFieldName: removeFieldName,
    removeFieldError: removeFieldError,
    showUpdateDialog: showUpdateDialog,
    showDeleteDialog: showDeleteDialog,
    showClearConfirm: showClearConfirm,
    clearConfirmText: clearConfirmText,
    clearBusy: clearBusy,
    clearError: clearError,
    onFieldEditSave: onFieldEditSave,
    onRemoveFieldConfirm: onRemoveFieldConfirm,
    onClearConfirm: onClearConfirm,
    onUpdateDialogDone: onUpdateDialogDone,
    onDeleteDialogDone: onDeleteDialogDone,
  }
}
