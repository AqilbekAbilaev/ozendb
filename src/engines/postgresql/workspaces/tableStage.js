import { computed } from 'vue'
import { updateRow, deleteRows as deleteRowsApi, insertRow, beginTransaction, commitTransaction, rollbackTransaction } from '../api/queries'
import { errMessage } from '../../../utils/errors'
import { formatCell } from './formatCell.js'
import { buildInsertSql, buildUpdateSql, buildDeleteSql } from './buildStagedSql.js'

const JSON_TYPES = ['json', 'jsonb']

// A row's identity as a stable string, from its primary-key columns' loaded values —
// what `edits`/`deletedKeys` key by, and what a staged insert (no real identity yet)
// never has one of.
function rowKeyOf(keyColumns, row, at) {
  return JSON.stringify(keyColumns.map(name => row[at(name)]))
}

// A readable, display-only SQL literal — never bound or executed, only shown in
// Review SQL. The real statements this staged state amounts to are built server-side
// (row_write.rs), with real type casts; this just has to read sensibly.
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`
}

// Staged editing, inserting and deleting for a table tab: nothing reaches the server
// until saveChanges runs every pending change in one transaction. Cell edits still
// show immediately (the row's displayed value is updated in place), but only as a
// local draft — reverted by restoreRow or a plain refresh, never auto-committed.
export function useTableStage(t, connectionReadOnly) {
  const { target, rows, columns, view, editError, refByKey, columnInfo, keyColumns, at, refresh, tabReadOnly } = t
  const staged = t.runtime.staged

  // Locked either way: `connectionReadOnly` is the backend's own refusal (static for
  // the tab's life — the connection can't change while it's open), `tabReadOnly` is
  // the tab's own accidental-edit lock (tableState.js), toggled live.
  const locked = () => connectionReadOnly || tabReadOnly.value

  // A staged insert as the grid renders it: one row array in the same column order as
  // everything else, appended after the loaded page — so a grid row index past
  // `rows.value.length` is draft number `index - rows.value.length`, no separate
  // rendering path needed.
  const insertRows = computed(() => staged.inserts.map(draft => view.value.columns.map(column => draft.values[column] ?? null)))
  const insertDrafts = computed(() => staged.inserts)

  // Only the browsed table's own cells are editable, by its primary key — and never
  // an identity-always or stored-generated column, which Postgres never accepts a
  // value for. Arrays aren't editable yet: their text form (`{a,b}`) isn't what the
  // grid shows. A draft insert row (rowIndex past the loaded page) skips the
  // primary-key gate entirely — an insert needs no WHERE clause.
  function canEdit(key, rowIndex) {
    const ref = refByKey.value[key]
    const column = ref?.info?.name ?? key
    if (rowIndex >= rows.value.length) return canEditInsertColumn(column)
    if (locked() || keyColumns.value.length === 0 || ref?.table !== 0) return false
    return canEditInsertColumn(column)
  }

  // The same identity/generated exclusion, for a staged insert's draft cells — which
  // have no `refByKey` entry to read it from, since they aren't part of the loaded page.
  function canEditInsertColumn(column) {
    if (locked()) return false
    const info = columnInfo.value[column]
    return !(info?.identity === 'always' || info?.generated === 'stored')
  }

  // JSON and array columns are edited as JSON — arrays as the list the grid shows.
  const asJson = (column) => {
    const type = columnInfo.value[column]?.dataType ?? ''
    return JSON_TYPES.includes(type) || type.endsWith('[]')
  }

  // The editor's starting text: JSON (so a string keeps its quotes and saving it
  // unchanged parses back) where asJson, everything else as displayed, NULL as empty.
  function editText(column, value) {
    if (value === null) return ''
    return asJson(column) ? JSON.stringify(value) : formatCell(value)
  }

  // `text` null is the editor's Set NULL, never text to parse.
  function parseInput(column, text) {
    if (text === null || !asJson(column)) return text
    const isArray = columnInfo.value[column].dataType.endsWith('[]')
    let value
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error(`"${column}" holds ${isArray ? 'a list' : 'JSON'}, and that isn't valid JSON.`)
    }
    if (isArray && !Array.isArray(value)) throw new Error(`"${column}" holds a list: write it like ["a", "b"].`)
    return value
  }

  // Stages one cell's edit — no network call. Keeps the column's first-seen original
  // value alongside whatever's newest, so restoreRow has something to revert to even
  // after several edits to the same cell. A draft insert row (past the loaded page)
  // routes to stageInsertValue instead — same grid gesture, different staged bucket.
  function stageEdit(rowIndex, key, text) {
    if (rowIndex >= rows.value.length) {
      const draft = staged.inserts[rowIndex - rows.value.length]
      return draft ? stageInsertValue(draft.key, refByKey.value[key]?.info?.name ?? key, text) : false
    }
    editError.value = null
    const row = rows.value[rowIndex]
    try {
      const value = parseInput(key, text)
      const column = refByKey.value[key].name
      const rowKey = rowKeyOf(keyColumns.value, row, at)
      const existing = staged.edits[rowKey]?.[column]
      staged.edits[rowKey] = { ...staged.edits[rowKey], [column]: { original: existing ? existing.original : row[at(key)], value } }
      row[at(key)] = value
      return true
    } catch (e) {
      editError.value = errMessage(e)
      return false
    }
  }

  function isDeleted(rowIndex) {
    const row = rows.value[rowIndex]
    return row ? staged.deletedKeys.includes(rowKeyOf(keyColumns.value, row, at)) : false
  }

  // Flips whether these grid rows are staged for deletion. A row that's also been
  // edited drops that edit — there's nothing to save on a row about to be removed.
  function toggleDelete(indexes) {
    if (locked()) return
    for (const i of indexes) {
      const row = rows.value[i]
      if (!row) continue
      const key = rowKeyOf(keyColumns.value, row, at)
      const at_ = staged.deletedKeys.indexOf(key)
      if (at_ >= 0) staged.deletedKeys.splice(at_, 1)
      else {
        staged.deletedKeys.push(key)
        delete staged.edits[key]
      }
    }
  }

  // Undoes whatever's staged on this loaded row: un-deletes it, and/or reverts every
  // staged cell back to its original value. A staged insert isn't reached through
  // here — see removeInsert.
  function restoreRow(rowIndex) {
    const row = rows.value[rowIndex]
    if (!row) return
    const key = rowKeyOf(keyColumns.value, row, at)
    const wasDeleted = staged.deletedKeys.indexOf(key)
    if (wasDeleted >= 0) staged.deletedKeys.splice(wasDeleted, 1)
    const edits = staged.edits[key]
    if (edits) {
      // `edits` is keyed by bare column name, and stageEdit only ever stages a
      // table-0 column — which columnRefs.js keys by that same bare name (no join
      // prefix for the browsed table), so it's also the grid key `at` expects.
      for (const [column, { original }] of Object.entries(edits)) row[at(column)] = original
      delete staged.edits[key]
    }
  }

  // A blank staged draft, appended to the pending inserts — rendering it into the
  // grid, and populating its cells, is the caller's job (stageInsertValue below).
  function addRow() {
    if (locked()) return null
    const key = crypto.randomUUID()
    staged.inserts.push({ key, values: {} })
    return key
  }

  // Same as addRow, seeded from a loaded row's current (possibly already-edited)
  // values — identity/generated columns are left out, exactly as addRow leaves them
  // for the server to fill in.
  function duplicateRow(rowIndex) {
    if (locked()) return null
    const row = rows.value[rowIndex]
    if (!row) return null
    const values = {}
    for (const column of columns.value) {
      if (!canEditInsertColumn(column)) continue
      values[column] = row[at(column)]
    }
    const key = crypto.randomUUID()
    staged.inserts.push({ key, values })
    return key
  }

  function stageInsertValue(key, column, text) {
    const draft = staged.inserts.find(d => d.key === key)
    if (!draft) return false
    try {
      draft.values[column] = parseInput(column, text)
      return true
    } catch (e) {
      editError.value = errMessage(e)
      return false
    }
  }

  function removeInsert(key) {
    const i = staged.inserts.findIndex(d => d.key === key)
    if (i >= 0) staged.inserts.splice(i, 1)
  }

  const pendingCount = computed(() => Object.keys(staged.edits).length + staged.deletedKeys.length + staged.inserts.length)
  const deletedCount = computed(() => staged.deletedKeys.length)

  // A readable preview of every pending change, one statement per row (or, for
  // deletes, one statement for the whole batch) — not the exact bound SQL the
  // server runs (see sqlLiteral), just close enough to review. Each statement is
  // laid out over several lines (see buildStagedSql.js) rather than one that runs
  // off the edge for a table with many columns, with a blank line between them.
  const reviewSql = computed(() => {
    const qualified = `${target.schema}.${target.table}`
    const statements = []
    for (const draft of staged.inserts) {
      const cols = Object.keys(draft.values)
      if (!cols.length) continue
      statements.push(buildInsertSql(qualified, cols, cols.map(c => sqlLiteral(draft.values[c]))))
    }
    for (const [key, edits] of Object.entries(staged.edits)) {
      const where = JSON.parse(key).map((value, i) => `${keyColumns.value[i]} = ${sqlLiteral(value)}`).join(' AND ')
      const set = Object.entries(edits).map(([column, { value }]) => `${column} = ${sqlLiteral(value)}`)
      statements.push(buildUpdateSql(qualified, set, where))
    }
    if (staged.deletedKeys.length) {
      const keyCols = keyColumns.value.join(', ')
      const tuples = staged.deletedKeys.map(key => `(${JSON.parse(key).map(sqlLiteral).join(', ')})`)
      statements.push(buildDeleteSql(qualified, keyCols, tuples))
    }
    return statements.join('\n\n')
  })

  // Runs every pending change in one transaction: any failure rolls it back and
  // leaves every pending change staged, untouched, to fix and retry. Success clears
  // the staged state and refreshes, so the grid shows exactly what the server has.
  async function saveChanges() {
    editError.value = null
    if (!pendingCount.value) return true
    if (locked()) {
      editError.value = 'This tab is read-only.'
      return false
    }
    const txId = crypto.randomUUID()
    try {
      await beginTransaction(target.connectionId, txId)
      for (const draft of staged.inserts) {
        const affected = await insertRow(target, Object.entries(draft.values).map(([column, value]) => ({ column, value })), txId)
        if (affected !== 1) throw new Error('An insert failed unexpectedly.')
      }
      for (const [key, edits] of Object.entries(staged.edits)) {
        const where = JSON.parse(key).map((value, i) => ({ column: keyColumns.value[i], value }))
        const set = Object.entries(edits).map(([column, { value }]) => ({ column, value }))
        const before = Object.entries(edits).map(([column, { original }]) => ({ column, value: original }))
        const affected = await updateRow(target, set, before, where, txId)
        if (affected !== 1) throw new Error('A row changed or was deleted since it was loaded.')
      }
      if (staged.deletedKeys.length) {
        const rows = staged.deletedKeys.map(key => JSON.parse(key).map((value, i) => ({ column: keyColumns.value[i], value })))
        const affected = await deleteRowsApi(target, rows, txId)
        if (affected !== staged.deletedKeys.length) throw new Error('Some rows changed or were already deleted since they were loaded.')
      }
      await commitTransaction(txId)
    } catch (e) {
      await rollbackTransaction(txId).catch(() => {})
      editError.value = errMessage(e)
      return false
    }
    staged.edits = {}
    staged.deletedKeys = []
    staged.inserts = []
    await refresh()
    return true
  }

  // Nothing was ever sent to the server while staged, so there's no server-side
  // transaction to roll back — just the local draft to drop. A refresh re-reads the
  // page from the server, which already has none of it, so it doubles as reverting
  // every staged edit's displayed value back to what's actually loaded.
  function discardAll() {
    staged.edits = {}
    staged.deletedKeys = []
    staged.inserts = []
    editError.value = null
    return refresh()
  }

  return {
    canEdit, canEditInsertColumn, editText, stageEdit, isDeleted, toggleDelete, restoreRow,
    addRow, duplicateRow, stageInsertValue, removeInsert, insertRows, insertDrafts,
    pendingCount, deletedCount, reviewSql, saveChanges, discardAll,
  }
}
