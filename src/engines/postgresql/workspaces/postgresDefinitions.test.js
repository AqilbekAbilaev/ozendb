import { describe, it, expect, vi, beforeEach } from 'vitest'

const rollbackTransaction = vi.fn(() => Promise.resolve())
const showToast = vi.fn()
vi.mock('../api/queries', async (original) => ({ ...(await original()), rollbackTransaction }))
vi.mock('../../../stores/toast', () => ({ showToast }))

const { postgresDefinitions } = await import('./postgresDefinitions.js')
const { createTableState, createTableUi, createTableRuntime } = await import('../../sql/workspaces/tableState.js')
const { createSqlRun } = await import('../../sql/workspaces/runSql.js')

beforeEach(() => vi.clearAllMocks())

const byType = Object.fromEntries(postgresDefinitions.map(d => [d.type, d]))
// What the PostgreSQL openers pass: flat fields, which become the tab's ref (#303).
const target = { connectionId: 'c1', connectionName: 'local', database: 'app', schema: 'public', table: 'users' }
// A live or saved tab, which carries its ref and display name rather than flat identity.
const tabOf = (created) => ({ ...created.fields, target: created.target })

describe('postgresql.table_browse', () => {
  const def = byType['postgresql.table_browse']

  it('names the table by database, schema and table', () => {
    const created = def.create({ target })
    expect(created.title).toBe('users')
    expect(created.target).toEqual({
      connectionId: 'c1',
      segments: [
        { kind: 'database', name: 'app' },
        { kind: 'schema', name: 'public' },
        { kind: 'table', name: 'users' },
      ],
    })
    expect(created.fields).toEqual({ connectionName: 'local', state: createTableState(), ui: createTableUi(), runtime: createTableRuntime('postgresql', 'c1') })
  })

  // A table tab with a query built, on page 3, a sort paused and the builder open.
  function built() {
    const tab = { ...tabOf(def.create({ target })), id: 't1', title: 'users' }
    tab.state.query.filterText = { name: 'ad' }
    tab.state.query.offset = 100
    tab.state.paused.sort = { column: 'id', desc: true }
    tab.ui.builderOpen = true
    tab.runtime.rows = [[1, 'Ada']]
    return tab
  }

  it('duplicates onto the same table, with its query and panel but none of its rows', () => {
    const tab = built()
    const copy = def.duplicate(tab)
    expect(copy.fields.state).toEqual(tab.state)
    expect(copy.fields.ui).toEqual(tab.ui)
    expect(copy.fields.runtime).toEqual(createTableRuntime('postgresql', 'c1'))
    copy.fields.state.query.filterText.name = 'changed'
    expect(tab.state.query.filterText.name).toBe('ad')
  })

  it('saves the page, the pauses and the panel, and brings them back', () => {
    const tab = built()
    const saved = JSON.parse(JSON.stringify(def.serialize(tab)))
    expect(saved).toEqual({ state: tab.state, ui: tab.ui })
    const restored = def.restore({ target: tab.target, connectionName: 'local', ...saved })
    expect(restored.fields.state).toEqual(tab.state)
    expect(restored.fields.ui).toEqual(tab.ui)
  })

  it('opens a tab saved without its panel with the panel closed', () => {
    const saved = tabOf(def.create({ target }))
    expect(def.restore({ target: saved.target, connectionName: 'local', view: {} }).fields.ui).toEqual(createTableUi())
  })
})

describe('postgresql.query', () => {
  const def = byType['postgresql.query']
  const db = { connectionId: 'c1', connectionName: 'local', database: 'app' }

  it('opens an empty editor against the connection\'s database', () => {
    const created = def.create({ target: db })
    expect(created.title).toBe('SQL: app')
    expect(created.target).toEqual({ connectionId: 'c1', segments: [{ kind: 'database', name: 'app' }] })
    expect(created.fields).toEqual({ connectionName: 'local', state: { sql: '' }, runtime: { run: createSqlRun('postgresql', 'c1', 'app') } })
  })

  it('duplicates the SQL but not the result', () => {
    const tab = tabOf(def.create({ target: db }))
    tab.state.sql = 'SELECT 1'
    Object.assign(tab.runtime.run, { result: { rows: [[1]] }, error: 'x' })
    expect(def.duplicate(tab).fields).toMatchObject({ state: { sql: 'SELECT 1' }, runtime: { run: createSqlRun('postgresql', 'c1', 'app') } })
  })
})

// #180: Search in Schema as a tab, its typed search kept on the tab so it survives
// switching tabs; the result is runtime.
describe('postgresql.search', () => {
  const def = byType['postgresql.search']
  const schema = { connectionId: 'c1', connectionName: 'local', database: 'app', schema: 'public' }

  it('opens an empty search on the schema', () => {
    const created = def.create({ target: schema })
    expect(created.title).toBe('Search: public')
    expect(created.target).toEqual({ connectionId: 'c1', segments: [{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }] })
    expect(created.fields).toEqual({
      connectionName: 'local',
      state: { term: '', tables: '', matchCase: false, regex: false },
      runtime: { result: null, loading: false, error: null, errorCode: null, runId: null },
    })
  })

  it('duplicates the typed search but not the result', () => {
    const tab = tabOf(def.create({ target: schema }))
    tab.state.term = 'Ada'
    tab.runtime.result = { matches: [] }
    const copy = def.duplicate(tab)
    expect(copy.fields.state.term).toBe('Ada')
    expect(copy.fields.runtime.result).toBe(null)
  })

  it('saves the typed search and brings it back', () => {
    const tab = tabOf(def.create({ target: schema }))
    tab.state.term = 'Ada'
    tab.state.regex = true
    const restored = def.restore({ target: tab.target, connectionName: 'local', ...def.serialize(tab) })
    expect(restored.fields.state).toEqual({ term: 'Ada', tables: '', matchCase: false, regex: true })
    expect(restored.title).toBe('Search: public')
  })
})

describe('closing a tab with a transaction open', () => {
  it('rolls a query tab\'s transaction back and says so', async () => {
    const def = byType['postgresql.query']
    await def.dispose({ id: 'q1', runtime: { run: { engine: 'postgresql', txId: 'tx-1' } } })
    expect(rollbackTransaction).toHaveBeenCalledWith('tx-1')
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/rolled back/))

    await def.dispose({ id: 'q2', runtime: { run: { engine: 'postgresql', txId: null } } })
    expect(rollbackTransaction).toHaveBeenCalledTimes(1)
  })

  it('rolls back a table tab\'s SQL-mode transaction', async () => {
    await byType['postgresql.table_browse'].dispose({ id: 't1', runtime: { sqlRun: { engine: 'postgresql', txId: 'tx-2' } } })
    expect(rollbackTransaction).toHaveBeenCalledWith('tx-2')
  })
})
