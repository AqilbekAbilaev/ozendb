// What every MongoDB workspace's `create` is handed: `{ resource, connectionName }`
// (#193), the same payload the registry modals take. A tab's own fields stay in the long
// spelling until the tab shape itself moves, so this spells them out from the ref once.
export function createdFields(ctx) {
  const { resource, connectionName } = ctx.target
  const [database, collection] = resource.segments
  return {
    connectionId: resource.connectionId,
    connectionName: connectionName ?? null,
    dbName: database?.name ?? null,
    collectionName: collection?.name ?? null,
  }
}
