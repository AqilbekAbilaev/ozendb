import { runQuery } from '../api/queries'
import { errMessage } from '../../../utils/errors'

// Runs a query tab's SQL and keeps the outcome on the tab, so it survives switching
// tabs. A second run while one is in flight is ignored.
export async function runSql(tab) {
  if (tab.running) return
  tab.running = true
  tab.error = null
  try {
    tab.result = await runQuery(tab.connectionId, tab.sql)
  } catch (e) {
    tab.error = errMessage(e)
    tab.result = null
  } finally {
    tab.running = false
  }
}
