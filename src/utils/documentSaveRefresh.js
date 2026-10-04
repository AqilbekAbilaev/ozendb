import { parseField } from './queryParser'

export function refreshFindWorkspacesAfterDocumentSave(workspaces, payload = {}, runQuery) {
  payload = payload || {}
  for (const workspace of workspaces) {
    if (workspace.type !== 'mongodb.find' || !workspace.runtime.hasRun
        || workspace.connectionId !== payload.connId || workspace.dbName !== payload.db
        || workspace.collectionName !== payload.coll) continue

    const filter = parseField(workspace.state.query.filter || '')
    const projection = parseField(workspace.state.query.projection || '')
    const sort = parseField(workspace.state.query.sort || '')
    runQuery(workspace.id, {
      filter: filter.ok ? filter.ejson : '{}',
      projection: projection.ok ? projection.ejson : '{}',
      sort: sort.ok ? sort.ejson : '{}',
      skip: Number(workspace.state.query.skip),
      limit: Number(workspace.state.query.limit),
    })
  }
}
