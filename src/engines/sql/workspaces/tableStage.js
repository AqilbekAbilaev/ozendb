import { computed } from 'vue'
import { errMessage } from '../../../utils/errors'
import { formatCell } from './formatCell.js'
import { buildInsertSql, buildUpdateSql, buildDeleteSql } from './buildStagedSql.js'
import { gridLayout } from './gridLayout.js'

// A row's identity as a stable string, from its primary-key columns' loaded values —
// what `edits`/`deletedKeys` key by, and what a staged insert (no real identity yet)
// never has one of.
function rowKeyOf(keyColumns, row, at) {
  return JSON.stringify(keyColumns.map(name => row[at(name)]))
}

// A readable, display-only SQL literal — never bound or executed, only shown in
// Review SQL. The real statements this staged state amounts to are built server-side
// (row_write.rs), with real type casts; this just has to read sensibly.
function sqlLiteral(dialect, value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return dialect.quoteText(typeof value === 'string' ? value : JSON.stringify(value))
}

// Staged editing, inserting and deleting for a table tab: nothing reaches the server
// until saveChanges runs every pending change in one transaction. Cell edits still
// show immediately (the row's displayed value is updated in place), but only as a
// local draft — reverted by restoreRow or a plain refresh, never auto-committed.
export function useTableStage(t, connectionReadOnly) {
  const { dialect, api, target, rows, columns, view, editError, refByKey, columnInfo, keyColumns, at, refresh, tabReadOnly, offset } = t
  const staged = t.runtime.staged

  // Locked either way: `connectionReadOnly` is the backend's own refusal (static for
  // the tab's life — the connection can't change while it's open), `tabReadOnly` is
  // the tab's own accidental-edit lock (tableState.js), toggled live.
  const locked = () => connectionReadOnly || tabReadOnly.value

  // A staged insert as the grid renders it: one row array in the same column order as
  // everything else.
  const draftRow = (draft) => view.value.columns.map(column => draft.values[column] ?? null)
  const insertRows = computed(() => staged.inserts.map(draftRow))
  const insertDrafts = computed(() => staged.inserts)

  // The grid shows each new row right after the row it was made from (#170), so a grid
  // position is looked up in the layout rather than compared with the page's length.
  // Without a primary key every row's key would be the same, so nothing anchors there.
  const rowKeys = computed(() => rows.value.map(row => (keyColumns.value.length ? rowKeyOf(keyColumns.value, row, at) : null)))
  const layout = computed(() => gridLayout(rowKeys.value, staged.inserts))
  const draftByKey = (key) => staged.inserts.find(d => d.key === key)
  const gridRows = computed(() => layout.value.map(entry => ('row' in entry ? view.value.rows[entry.row] : draftRow(draftByKey(entry.draft)))))
  const loadedAt = (index) => layout.value[index]?.row ?? null
  const draftAt = (index) => {
    const key = layout.value[index]?.draft
    return key ? draftByKey(key) : null
  }
  const gridIndexOf = (key) => layout.value.findIndex(entry => entry.draft === key)

  function rowStatus(index) {
    if (draftAt(index)) return 'inserted'
    return isDeleted(index) ? 'deleted' : null
  }

  // A loaded row keeps its number on the page; a new row has none yet.
  function rowNumber(index) {
    const row = loadedAt(index)
    return row === null ? '+' : offset.value + row + 1
  }

  // Only the browsed table's own cells are editable, by its primary key — and never a
  // column the server won't take a value for (dialect.takesValue). A draft insert row
  // skips the primary-key gate entirely — an insert needs no WHERE clause.
  function canEdit(key, index) {
    const ref = refByKey.value[key]
    const column = ref?.info?.name ?? key
    if (draftAt(index)) return canEditInsertColumn(column)
    if (locked() || keyColumns.value.length === 0 || ref?.table !== 0) return false
    return canEditInsertColumn(column)
  }

  // The same exclusion, for a staged insert's draft cells — which have no `refByKey`
  // entry to read it from, since they aren't part of the loaded page.
  function canEditInsertColumn(column) {
    if (locked()) return false
    return dialect.takesValue(columnInfo.value[column])
  }

  // JSON and list columns are edited as JSON — lists as the list the grid shows.
  const shapeOf = (column) => dialect.jsonShape(columnInfo.value[column]?.dataType)

  // The editor's starting text: JSON (so a string keeps its quotes and saving it
  // unchanged parses back) where shapeOf says so, everything else as displayed, NULL as empty.
  function editText(column, value) {
    if (value === null) return ''
    return shapeOf(column) ? JSON.stringify(value) : formatCell(value)
  }

  // `text` null is the editor's Set NULL, never text to parse.
  function parseInput(column, text) {
    const shape = shapeOf(column)
    if (text === null || !shape) return text
    const isArray = shape === 'list'
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
  // after several edits to the same cell. A draft insert row routes to
  // stageInsertValue instead — same grid gesture, different staged bucket.
  function stageEdit(index, key, text) {
    const draft = draftAt(index)
    if (draft) return stageInsertValue(draft.key, refByKey.value[key]?.info?.name ?? key, text)
    const row = rows.value[loadedAt(index)]
    if (!row) return false
    editError.value = null
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

  function isDeleted(index) {
    const row = rows.value[loadedAt(index)]
    return row ? staged.deletedKeys.includes(rowKeyOf(keyColumns.value, row, at)) : false
  }

  // Flips whether these grid rows are staged for deletion. A row that's also been
  // edited drops that edit — there's nothing to save on a row about to be removed.
  function toggleDelete(indexes) {
    if (locked()) return
    for (const i of indexes) {
      const row = rows.value[loadedAt(i)]
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

  // Undoes whatever's staged on this grid row: drops a new row, or un-deletes a loaded
  // one and/or reverts every staged cell back to its original value.
  function restoreRow(index) {
    const draft = draftAt(index)
    if (draft) return removeInsert(draft.key)
    const row = rows.value[loadedAt(index)]
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

  // A new draft shown right after the grid row at `afterIndex` (#170): after a loaded
  // row by its key, or right after another new row by sharing its anchor and following
  // it in staged order. No `afterIndex` (nothing selected) puts it at the end.
  function stageInsert(values, afterIndex) {
    const draft = { key: crypto.randomUUID(), values, after: null }
    const before = afterIndex == null ? null : draftAt(afterIndex)
    if (before) {
      draft.after = before.after
      staged.inserts.splice(staged.inserts.indexOf(before) + 1, 0, draft)
    } else {
      const row = afterIndex == null ? null : loadedAt(afterIndex)
      if (row !== null) draft.after = rowKeys.value[row]
      staged.inserts.push(draft)
    }
    return draft.key
  }

  // A blank staged draft — populating its cells is the caller's job (stageInsertValue
  // below).
  function addRow(afterIndex = null) {
    if (locked()) return null
    return stageInsert({}, afterIndex)
  }

  // Same as addRow, seeded from a loaded row's current (possibly already-edited)
  // values and shown right after it — generated and self-numbering columns
  // (dialect.fillsItself) are left out, exactly as addRow leaves them for the server to
  // fill in.
  function duplicateRow(index) {
    if (locked()) return null
    const row = rows.value[loadedAt(index)]
    if (!row) return null
    const values = {}
    for (const column of columns.value) {
      if (!canEditInsertColumn(column) || dialect.fillsItself(columnInfo.value[column])) continue
      values[column] = row[at(column)]
    }
    return stageInsert(values, index)
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
      statements.push(buildInsertSql(qualified, cols, cols.map(c => sqlLiteral(dialect, draft.values[c]))))
    }
    for (const [key, edits] of Object.entries(staged.edits)) {
      const where = JSON.parse(key).map((value, i) => `${keyColumns.value[i]} = ${sqlLiteral(dialect, value)}`).join(' AND ')
      const set = Object.entries(edits).map(([column, { value }]) => `${column} = ${sqlLiteral(dialect, value)}`)
      statements.push(buildUpdateSql(qualified, set, where))
    }
    if (staged.deletedKeys.length) {
      const keyCols = keyColumns.value.join(', ')
      const tuples = staged.deletedKeys.map(key => `(${JSON.parse(key).map(value => sqlLiteral(dialect, value)).join(', ')})`)
      statements.push(buildDeleteSql(qualified, keyCols, tuples))
    }
    return statements.join('\n\n')
  })

  // Saves every pending change in one transaction (the engine's saveRows): any failure
  // rolls it back and leaves every pending change staged, untouched, to fix and retry. Success clears
  // the staged state and refreshes, so the grid shows exactly what the server has.
  async function saveChanges() {
    editError.value = null
    if (!pendingCount.value) return true
    if (locked()) {
      editError.value = 'This tab is read-only.'
      return false
    }
    const pairs = (values) => Object.entries(values).map(([column, value]) => ({ column, value }))
    const keyOf = (key) => JSON.parse(key).map((value, i) => ({ column: keyColumns.value[i], value }))
    const changes = {
      inserts: staged.inserts.map(draft => pairs(draft.values)),
      updates: Object.entries(staged.edits).map(([key, edits]) => ({
        set: Object.entries(edits).map(([column, { value }]) => ({ column, value })),
        before: Object.entries(edits).map(([column, { original }]) => ({ column, value: original })),
        where: keyOf(key),
      })),
      deletes: staged.deletedKeys.map(keyOf),
    }
    try {
      await api.saveRows(target, changes)
    } catch (e) {
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
    gridRows, gridIndexOf, rowStatus, rowNumber, pendingCount, deletedCount, reviewSql, saveChanges, discardAll,
  }
}
