// App error log: listing, clearing, and reporting frontend errors. Messages are
// truncated here — the backend log is capped, and a giant trace adds nothing.

import { invoke } from '@tauri-apps/api/core'

export function listErrorLog() {
  return invoke('list_error_log')
}

export function getErrorReportContext() {
  return invoke('error_report_context')
}

export function clearErrorLog() {
  return invoke('clear_error_log')
}

export function recordFrontendError(message) {
  return invoke('record_frontend_error', { message: String(message).slice(0, 4000) })
}