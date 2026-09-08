import { ref } from 'vue'
import { importPreview } from '../engines/mongodb/api/transfer'
import { errText } from '../utils/errors'
import { PREVIEW_LIMIT } from '../constants/dataTools'

// Owns the asynchronous preview for an import workspace. The lifecycle token keeps a
// slow response from a previously selected source or tab from replacing current rows.
export function useImportPreview({ tab, activeTab, lifecycle }) {
  const loading = ref(false)
  const error = ref(null)
  const columns = ref([])
  const rows = ref([])

  function reset() {
    loading.value = false
    error.value = null
    columns.value = []
    rows.value = []
  }

  function toggle() {
    tab.value.previewOpen = !tab.value.previewOpen
  }

  async function loadPreview() {
    const source = tab.value.sources[tab.value.selectedSource]
    error.value = null
    columns.value = []
    rows.value = []
    if (!source) {
      lifecycle.cancelPreview()
      loading.value = false
      return
    }
    const request = lifecycle.beginPreview(tab.value, source)
    loading.value = true
    try {
      const preview = await importPreview(request.path, request.format, PREVIEW_LIMIT)
      if (!lifecycle.isCurrentPreview(request, activeTab())) return
      columns.value = preview.columns || []
      rows.value = preview.rows || []
    } catch (e) {
      if (!lifecycle.isCurrentPreview(request, activeTab())) return
      error.value = errText(e)
    } finally {
      if (lifecycle.isCurrentPreview(request, activeTab())) loading.value = false
    }
  }

  return { loading, error, columns, rows, reset, toggle, loadPreview }
}
