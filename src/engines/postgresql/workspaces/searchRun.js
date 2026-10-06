// A PostgreSQL search tab's search (#180): what the user typed is `state`, saved with
// the session; the last result is `runtime`. Both live on the tab rather than in the
// workspace component, which is unmounted whenever another kind of tab shows, so a
// search survives a look at one of its matches.
import { searchTables } from '../api/resources'
import { cancelQuery } from '../api/queries'
import { errText, errCode } from '../../../utils/errors'

export function createSearchState() {
  return { term: '', tables: '', matchCase: false, regex: false }
}

export function createSearchRuntime() {
  return { result: null, loading: false, error: null, errorCode: null, runId: null }
}

// Comma-separated table names; blank means every table in the schema.
function tableList(text) {
  const names = text.split(',').map((s) => s.trim()).filter(Boolean)
  return names.length ? names : null
}

export async function runSearch(tab) {
  const { state, runtime } = tab
  const term = state.term.trim()
  if (!term || runtime.loading) return
  runtime.loading = true
  runtime.error = null
  runtime.errorCode = null
  runtime.result = null
  runtime.runId = crypto.randomUUID()
  try {
    runtime.result = await searchTables(
      { connectionId: tab.connectionId, schema: tab.schema, tables: tableList(state.tables) },
      term,
      { matchCase: state.matchCase, regex: state.regex, runId: runtime.runId },
    )
  } catch (e) {
    runtime.error = errText(e)
    runtime.errorCode = errCode(e)
  } finally {
    runtime.loading = false
    runtime.runId = null
  }
}

export function cancelSearch(tab) {
  if (tab.runtime.runId) cancelQuery(tab.connectionId, tab.runtime.runId).catch(() => {})
}
