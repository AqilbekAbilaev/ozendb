import { runQuery, cancelQuery, explainQuery, formatQuery, beginTransaction, commitTransaction, rollbackTransaction } from '../api/queries'
import { pushHistory } from '../api/library'
import { errMessage } from '../../../utils/errors'
import { createSelection } from '../../../composables/useRowSelection'

// A SQL editor's runs against one connection: the last result, a line per run, the plan
// Explain found, and the Manual-mode transaction. Runtime only — the SQL itself is the
// tab's lasting state, passed in to each call. `database`, when it names a database
// other than the connection's own, opens a second database on the same server
// (ozendb-bj2) — `null` behaves exactly as the connection's own.
export function createSqlRun(connectionId, database = null) {
  return {
    connectionId, database,
    result: null, error: null, running: false, runId: null, messages: [],
    txn: 'auto', txId: null,
    plan: null, planError: null, explaining: false,
    selection: createSelection(),
  }
}

const log = (run, ok, text, ms) => { run.messages = [...run.messages, { at: new Date(), ok, text, ms }] }

// Runs `sql` and keeps the outcome on `run`, with a line per run in its messages. A
// second run while one is in flight is ignored; the one in flight can be cancelled. A
// run that succeeds joins the connection's history. With `run.txn` 'manual', runs go
// into its transaction (`run.txId`), begun by the first of them.
export async function runSql(run, sql) {
  if (run.running) return
  run.running = true
  run.error = null
  run.runId = crypto.randomUUID()
  try {
    if (run.txn === 'manual' && !run.txId) await begin(run)
    run.result = await runQuery(run.connectionId, sql, run.runId, run.txId ?? null, run.database)
    log(run, true, outcome(run.result), run.result.elapsedMs)
    pushHistory(run.connectionId, sql).catch(() => {})
  } catch (e) {
    run.error = errMessage(e)
    run.result = null
    log(run, false, run.error)
  } finally {
    run.running = false
    run.runId = null
    run.selection = createSelection()
  }
}

async function begin(run) {
  const txId = crypto.randomUUID()
  await beginTransaction(run.connectionId, txId, run.database)
  run.txId = txId
}

// Commits (or rolls back) the run's transaction. It's over either way — a failed
// commit included, which the backend has rolled back.
export async function endTransaction(run, commit) {
  const txId = run.txId
  if (!txId) return
  run.txId = null
  try {
    await (commit ? commitTransaction : rollbackTransaction)(txId)
    log(run, true, commit ? 'COMMIT' : 'ROLLBACK')
  } catch (e) {
    log(run, false, errMessage(e))
  }
}

// For a tab going away: rolls back its open transaction, if any, and says whether
// there was one.
export async function abandonTransaction(run) {
  const txId = run?.txId
  if (!txId) return false
  run.txId = null
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
export function cancelSql(run) {
  if (run.runId) return cancelQuery(run.connectionId, run.runId)
}

// Explains `sql`, keeping the plan (or why there isn't one) on the run.
export async function explainSql(run, sql) {
  run.explaining = true
  run.planError = null
  try {
    run.plan = await explainQuery(run.connectionId, sql, run.database)
  } catch (e) {
    run.plan = null
    run.planError = errMessage(e)
  } finally {
    run.explaining = false
  }
}

// `sql` laid out, or — for SQL that can't be formatted — as typed, with the reason.
export async function formatSql(sql) {
  try {
    return { sql: await formatQuery(sql), reason: null }
  } catch (e) {
    return { sql, reason: errMessage(e) }
  }
}
