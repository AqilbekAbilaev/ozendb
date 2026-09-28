import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'
import { COLUMNS, SAVED_TABLE_STATES } from './tableState.fixtures.js'

const browseTable = vi.fn()
const countTable = vi.fn()
const listColumns = vi.fn()
vi.mock('../api/queries', async (original) => ({
  ...(await original()), browseTable, countTable,
  runQuery: vi.fn(() => Promise.resolve({ columns: ['v', 'e'], rows: [['16', 'UTF8']] })),
}))
vi.mock('../api/resources', async (original) => ({ ...(await original()), listColumns, listForeignKeys: vi.fn(() => Promise.resolve([])) }))
vi.mock('../api/library', () => ({ pushHistory: vi.fn(() => Promise.resolve()) }))

const { registerWorkspaceDefinitions } = await import('../../../workspaces/registerDefinitions.js')
const { restoreWorkspace } = await import('../../../workspaces/lifecycle.js')
const { getWorkspaceDefinition } = await import('../../../workspaces/registry.js')
const { toLegacyRecord } = await import('../../../utils/sessionMigration.js')
const { usePostgresTable } = await import('./usePostgresTable.js')
registerWorkspaceDefinitions()

const TYPE = 'postgresql.table_browse'
const target = {
  connectionId: 'c1',
  segments: [{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'users' }],
}
const record = (state, id = 't1') => ({ id, type: TYPE, engine: 'postgresql', title: 'users', color: null, target, state })

// The session's own path back from disk: a v2 record, then the tab it restores to.
const restore = (state, id) => restoreWorkspace(toLegacyRecord(record(state, id), 'local'), { defaults: {} })
// What the session saves for a live tab.
const serialize = (tab) => JSON.parse(JSON.stringify(getWorkspaceDefinition(TYPE).serialize(tab)))

// The one place these specs reach into how a tab holds its state; the plan's steps
// (postgresql-tab-objects.md) change only this, never the fixtures or expectations.
async function load(tab) {
  const t = reactive(usePostgresTable(reactive(tab)))
  await t.load()
  return { mode: t.mode, sql: t.sql, filterText: t.filterText, shownColumns: t.shownColumns, columnOrder: t.columnOrder }
}

beforeEach(() => {
  vi.clearAllMocks()
  listColumns.mockImplementation(({ table }) => Promise.resolve(COLUMNS[table]))
  countTable.mockResolvedValue(3)
  browseTable.mockResolvedValue({ columns: [], rows: [], truncated: false, elapsedMs: 1 })
})

describe('a PostgreSQL table tab restored from a saved session', () => {
  for (const fixture of SAVED_TABLE_STATES) {
    it(`asks for what it asked for before it was saved: ${fixture.name}`, async () => {
      const tab = restore(fixture.state)
      expect(tab).toMatchObject({ type: TYPE, connectionId: 'c1', database: 'app', schema: 'public', table: 'users' })
      expect(await load(tab)).toEqual(fixture.tab)
      expect(browseTable).toHaveBeenLastCalledWith({ connectionId: 'c1', schema: 'public', table: 'users' }, fixture.browse)
    })

    it(`saves it again as a shape that restores the same: ${fixture.name}`, async () => {
      const first = restore(fixture.state)
      await load(first)
      const asked = browseTable.mock.calls.at(-1)
      const again = restore(serialize(first), 't2')
      expect(await load(again)).toEqual(fixture.tab)
      expect(browseTable.mock.calls.at(-1)).toEqual(asked)
    })
  }
})
