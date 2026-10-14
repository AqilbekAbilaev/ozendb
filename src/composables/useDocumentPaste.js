import { ref } from 'vue'
import { insertDocuments } from '../engines/mongodb/api/documents'
import { errText } from '../utils/errors'
import { isCollectionTab } from '../utils/workspaceTypes'
import { apiTarget } from '../engines/mongodb/api/payload'

// Holds a clipboard paste until the user confirms it, keeping the original collection
// target even when they change tabs while the confirmation dialog is open.
export function useDocumentPaste({ activeTab, showToast, requery }) {
  const pasteConfirm = ref(null)
  const pasteBusy = ref(false)

  async function pasteDocuments() {
    const tab = activeTab()
    if (!isCollectionTab(tab)) {
      showToast('Open a collection first')
      return
    }
    let text
    try {
      text = await navigator.clipboard.readText()
    } catch (_) {
      showToast('Cannot read from clipboard')
      return
    }
    if (!text || !text.trim()) {
      showToast('Clipboard is empty')
      return
    }
    pasteConfirm.value = {
      text,
      workspace: tab,
      ...apiTarget(tab.target),
    }
  }

  async function onPasteConfirm() {
    const target = pasteConfirm.value
    if (!target || pasteBusy.value) return
    pasteBusy.value = true
    try {
      const count = await insertDocuments({
        connectionId: target.connectionId,
        database: target.database,
        collection: target.collection,
      }, target.text)
      showToast(`Pasted ${count} document${count !== 1 ? 's' : ''}`)
      requery(true, target.workspace)
    } catch (e) {
      showToast(errText(e))
    } finally {
      pasteBusy.value = false
      pasteConfirm.value = null
    }
  }

  return { pasteConfirm, pasteBusy, pasteDocuments, onPasteConfirm }
}
