// Saves a table tab's staged rows (engines/sql/workspaces/tableStage.js) in one
// transaction held open across the row commands: any failure rolls it back.
import { beginTransaction, commitTransaction, rollbackTransaction, insertRow, updateRow, deleteRows } from './api/queries.js'

// `changes` is `{ inserts, updates, deletes }`: each insert and delete a row's
// `{ column, value }` list, a delete naming its primary key, and each update
// `{ set, before, where }`.
export async function saveRows(target, { inserts, updates, deletes }) {
  const txId = crypto.randomUUID()
  try {
    await beginTransaction(target.connectionId, txId)
    for (const values of inserts) {
      if (await insertRow(target, values, txId) !== 1) throw new Error('An insert failed unexpectedly.')
    }
    for (const { set, before, where } of updates) {
      if (await updateRow(target, set, before, where, txId) !== 1) throw new Error('A row changed or was deleted since it was loaded.')
    }
    if (deletes.length && await deleteRows(target, deletes, txId) !== deletes.length) {
      throw new Error('Some rows changed or were already deleted since they were loaded.')
    }
    await commitTransaction(txId)
  } catch (e) {
    await rollbackTransaction(txId).catch(() => {})
    throw e
  }
}
