import { runQuery, cancelQuery, explainQuery, formatQuery, beginTransaction, commitTransaction, rollbackTransaction } from '../api/queries'
import { pushHistory } from '../api/library'
import { errMessage } from '../../../utils/errors'

const log = (tab, ok, text, ms) => { tab.messages = [...(tab.messages ?? []), { at: new Date(), ok, text, ms }] }

// Runs a query tab's SQL — or `sql`, a selection of it — and keeps the outcome on the
// tab, so it survives switching tabs, with a line per run in `tab.messages`. A second
// run while one is in flight is ignored; the one in flight can be cancelled. A run
// that succeeds joins the connection's history. With `tab.txn` 'manual', runs go into
// the tab's transaction (`tab.txId`), begun by the first of them.
export async function runSql(tab, sql = tab.sql) {
  if (tab.running) return
  tab.running = true
  tab.error = null
  tab.runId = crypto.randomUUID()
  try {
    if (tab.txn === 'manual' && !tab.txId) await begin(tab)
    tab.result = await runQuery(tab.connectionId, sql, tab.runId, tab.txId ?? null)
    log(tab, true, outcome(tab.result), tab.result.elapsedMs)
    pushHistory(tab.connectionId, sql).catch(() => {})
  } catch (e) {
    tab.error = errMessage(e)
    tab.result = null
    log(tab, false, tab.error)
  } finally {
    tab.running = false
    tab.runId = null
  }
}

async function begin(tab) {
  const txId = crypto.randomUUID()
  await beginTransaction(tab.connectionId, txId)
  tab.txId = txId
}

// Commits (or rolls back) the tab's transaction. It's over either way — a failed
// commit included, which the backend has rolled back.
export async function endTransaction(tab, commit) {
  const txId = tab.txId
  if (!txId) return
  tab.txId = null
  try {
    await (commit ? commitTransaction : rollbackTransaction)(txId)
    log(tab, true, commit ? 'COMMIT' : 'ROLLBACK')
  } catch (e) {
    log(tab, false, errMessage(e))
  }
}

// For a tab going away: rolls back its open transaction, if any, and says whether
// there was one.
export async function abandonTransaction(tab) {
  const txId = tab.txId
  if (!txId) return false
  tab.txId = null
  try {
    await rollbackTransaction(txId)
  } catch {
    // The tab is going away; there is no one left to tell.
  }
  return true
}

// What a run did, in a line: the rows a query returned, or the rows a statement changed.
export function outcome({ rows, rowsAffected }) {
  if (rowsAffected == null) return `SELECT ${rows.length}`
  return `${rowsAffected} row${rowsAffected === 1 ? '' : 's'} affected`
}

// The run then ends with a "cancelled" error, handled like any other.
export function cancelSql(tab) {
  if (tab.runId) return cancelQuery(tab.connectionId, tab.runId)
}

// Explains the tab's SQL — or `sql` — keeping the plan (or why there isn't one) on it.
export async function explainSql(tab, sql = tab.sql) {
  tab.explaining = true
  tab.planError = null
  try {
    tab.plan = await explainQuery(tab.connectionId, sql)
  } catch (e) {
    tab.plan = null
    tab.planError = errMessage(e)
  } finally {
    tab.explaining = false
  }
}

// Formats the tab's SQL in place. SQL that can't be formatted stays as typed, and the
// reason is returned.
export async function formatSql(tab) {
  try {
    tab.sql = await formatQuery(tab.sql)
    return null
  } catch (e) {
    return errMessage(e)
  }
}
