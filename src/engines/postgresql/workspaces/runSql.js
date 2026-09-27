import { runQuery, cancelQuery } from '../api/queries'
import { errMessage } from '../../../utils/errors'

// Runs a query tab's SQL — or `sql`, a selection of it — and keeps the outcome on the
// tab, so it survives switching tabs, with a line per run in `tab.messages`. A second
// run while one is in flight is ignored; the one in flight can be cancelled.
export async function runSql(tab, sql = tab.sql) {
  if (tab.running) return
  tab.running = true
  tab.error = null
  tab.runId = crypto.randomUUID()
  const log = (ok, text, ms) => { tab.messages = [...(tab.messages ?? []), { at: new Date(), ok, text, ms }] }
  try {
    tab.result = await runQuery(tab.connectionId, sql, tab.runId)
    log(true, `SELECT ${tab.result.rows.length}`, tab.result.elapsedMs)
  } catch (e) {
    tab.error = errMessage(e)
    tab.result = null
    log(false, tab.error)
  } finally {
    tab.running = false
    tab.runId = null
  }
}

// The run then ends with a "cancelled" error, handled like any other.
export function cancelSql(tab) {
  if (tab.runId) return cancelQuery(tab.connectionId, tab.runId)
}
