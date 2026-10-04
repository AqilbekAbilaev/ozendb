import { ref } from 'vue'
import { setCollectionQueryMode } from '../utils/queryMode'

// The one copied query, shared across tabs so it can be pasted into any of them.
export const clipboardQuery = ref(null)

export function copyQuery(tab) {
  clipboardQuery.value = {
    mode:       tab.mode       || 'find',
    filter:     tab.state.query.filter     || '',
    sort:       tab.state.query.sort       || '',
    projection: tab.state.query.projection || '',
    skip:       tab.state.query.skip       ?? 0,
    limit:      tab.state.query.limit      ?? 50,
    pipeline:   tab.state.query.pipeline   || '',
  }
}

// Writes the copied query onto the tab; running it is the caller's job, through the
// same path as the Run button. Returns whether there was anything to paste.
export function pasteQuery(tab) {
  const q = clipboardQuery.value
  if (!q) return false
  setCollectionQueryMode(tab, q.mode)
  tab.state.query.filter     = q.filter
  tab.state.query.sort       = q.sort
  tab.state.query.projection = q.projection
  tab.state.query.skip       = Number(q.skip)
  tab.state.query.limit      = Number(q.limit)
  tab.state.query.pipeline   = q.pipeline
  return true
}
