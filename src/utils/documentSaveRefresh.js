import { parseField } from './queryParser'

export function refreshFindWorkspacesAfterDocumentSave(workspaces, payload = {}, runQuery) {
  payload = payload || {}
  for (const workspace of workspaces) {
    if (workspace.type !== 'mongodb.find' || !workspace.hasRun
        || workspace.connectionId !== payload.connId || workspace.dbName !== payload.db
        || workspace.collectionName !== payload.coll) continue

    const filter = parseField(workspace.filter || '')
    const projection = parseField(workspace.projection || '')
    const sort = parseField(workspace.sort || '')
    runQuery(workspace.id, {
      filter: filter.ok ? filter.ejson : '{}',
      projection: projection.ok ? projection.ejson : '{}',
      sort: sort.ok ? sort.ejson : '{}',
      skip: Number(workspace.skip),
      limit: Number(workspace.limit),
    })
  }
}
