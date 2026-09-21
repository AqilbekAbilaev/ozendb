import { ref } from 'vue'
import { setCollectionQueryMode } from '../utils/queryMode'

// The one copied query, shared across tabs so it can be pasted into any of them.
export const clipboardQuery = ref(null)

export function copyQuery(tab) {
  clipboardQuery.value = {
    mode:       tab.mode       || 'find',
    filter:     tab.filter     || '',
    sort:       tab.sort       || '',
    projection: tab.projection || '',
    skip:       tab.skip       ?? 0,
    limit:      tab.limit      ?? 50,
    pipeline:   tab.pipeline   || '',
  }
}

// Writes the copied query onto the tab; running it is the caller's job, through the
// same path as the Run button. Returns whether there was anything to paste.
export function pasteQuery(tab) {
  const q = clipboardQuery.value
  if (!q) return false
  setCollectionQueryMode(tab, q.mode)
  tab.filter     = q.filter
  tab.sort       = q.sort
  tab.projection = q.projection
  tab.skip       = Number(q.skip)
  tab.limit      = Number(q.limit)
  tab.pipeline   = q.pipeline
  return true
}
