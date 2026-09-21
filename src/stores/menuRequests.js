import { ref } from 'vue'

// One-shot requests from the native menu to the component that owns the UI for them.
// A component watches its request's `nonce`; a counter (not a timestamp) guarantees
// two requests back to back are still two changes.
let nonce = 0
function signal(target, extra) {
  target.value = { ...extra, nonce: ++nonce }
}

export const historyRequest           = ref(null)   // View → History Manager
export const saveQueryRequest         = ref(null)   // File → Save
export const savedQueryBrowserRequest = ref(null)   // File → Load
export const docMenuRequest           = ref(null)   // Document/Collection menu: { action }

export const requestHistory           = () => signal(historyRequest)
export const requestSaveQuery         = () => signal(saveQueryRequest)
export const requestSavedQueryBrowser = () => signal(savedQueryBrowserRequest)
export const requestDocAction         = (action) => signal(docMenuRequest, { action })
