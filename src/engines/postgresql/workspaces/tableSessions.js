// Each open table tab's live state (usePostgresTable), kept while the tab is open so
// switching away and back finds it as it was — rows, filters, joins, mode — instead
// of rebuilding it. Dropped by the definition's dispose hook when the tab closes.
const sessions = new Map()

export function tableSession(tabId, build) {
  if (!sessions.has(tabId)) sessions.set(tabId, build())
  return sessions.get(tabId)
}

export function peekTableSession(tabId) {
  return sessions.get(tabId) ?? null
}

export function dropTableSession(tabId) {
  sessions.delete(tabId)
}
