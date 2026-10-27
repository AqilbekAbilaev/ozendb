import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// The tab store builds its first tab from the registered definitions, so it is loaded
// after they are (see stores/tabCreators.test.js).
import { registerWorkspaceDefinitions } from '../../workspaces/registerDefinitions'
import { createResourceRef } from '../../utils/resourceRef'
registerWorkspaceDefinitions()

const openers = await import('./tabs')
const { tabs, activeTabId } = await import('../../stores/tabs')

function harness() {
  tabs.value = [{ id: 't0', type: 'app.quickstart', title: 'Quickstart' }]
  activeTabId.value = 't0'
  return openers
}

const lastTab = () => tabs.value[tabs.value.length - 1]

describe('MySQL queries', () => {
  it('opens a query tab in the database of the row it was opened on, and activates it', () => {
    const c = harness()
    const table = createResourceRef('m1', [{ kind: 'database', name: 'shop `2024` ü' }, { kind: 'table', name: 'order items' }])
    c.openMySqlQuery({ resource: table, connectionName: 'Shop MySQL' })
    expect(lastTab()).toMatchObject({ type: 'mysql.query', engine: 'mysql', title: 'SQL: shop `2024` ü', state: { sql: '' } })
    expect(lastTab().target.segments).toEqual([{ kind: 'database', name: 'shop `2024` ü' }])
    expect(activeTabId.value).toBe(lastTab().id)
  })
  it('opens a query tab holding the SQL it is given, in the database of a stored program\'s row', () => {
    const c = harness()
    const procedure = createResourceRef('m1', [{ kind: 'database', name: 'shop `2024` ü' }, { kind: 'procedure', name: 'p; ü' }])
    c.openMySqlQuery({ resource: procedure, connectionName: 'Shop MySQL', sql: 'CREATE PROCEDURE `p; ü`() SELECT 1' })
    expect(lastTab().state.sql).toBe('CREATE PROCEDURE `p; ü`() SELECT 1')
    expect(lastTab().target.segments).toEqual([{ kind: 'database', name: 'shop `2024` ü' }])
  })
})
