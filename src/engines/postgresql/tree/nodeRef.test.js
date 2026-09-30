import { describe, it, expect } from 'vitest'
import { pgNodeRef } from './nodeRef'
import { affectedByResource } from '../../../workspaces/lifecycle'
import { postgresDefinitions } from '../workspaces/postgresDefinitions'

const tableDef = postgresDefinitions.find(d => d.type === 'postgresql.table_browse')
const tab = (schema, table) => tableDef.create({
  target: { connectionId: 'c1', connectionName: 'local', database: 'app', schema, table },
})

describe('pgNodeRef', () => {
  it('names a node down to its deepest level', () => {
    expect(pgNodeRef({ connId: 'c1', database: 'app' }).segments).toEqual([{ kind: 'database', name: 'app' }])
    expect(pgNodeRef({ connId: 'c1', database: 'app', schema: 'public', table: 'users' }).segments.map(s => s.kind))
      .toEqual(['database', 'schema', 'table'])
  })

  // The ref must line up with the tabs' own targets, or a drop would leave them open.
  it('matches exactly the table tabs inside the dropped node', () => {
    const users = tab('public', 'users')
    const other = tab('crm', 'users')
    const dropTable = affectedByResource(pgNodeRef({ connId: 'c1', database: 'app', schema: 'public', table: 'users' }))
    const dropSchema = affectedByResource(pgNodeRef({ connId: 'c1', database: 'app', schema: 'crm' }))
    expect([dropTable(users), dropTable(other)]).toEqual([true, false])
    expect([dropSchema(users), dropSchema(other)]).toEqual([false, true])
  })
})
