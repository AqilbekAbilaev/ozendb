// A workspace's crumb row as `{ icon, label }` items: the login (when shown), the
// connection, each level of its ResourceRef, and an optional trailing pane crumb
// (Indexes, Schema…). The connection has no icon — the engine badge before it names
// what kind it is.
const ICONS = { database: 'dbSmall', schema: 'folder', table: 'table', collection: 'collSmall' }

export function crumbSegments({ user = null, connection, target, extra = null }) {
  return [
    ...(user ? [{ icon: null, label: user }] : []),
    { icon: null, label: connection },
    ...target.segments.map(({ kind, name }) => ({ icon: ICONS[kind] ?? null, label: name })),
    ...(extra ? [extra] : []),
  ]
}
