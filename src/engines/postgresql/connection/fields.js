// PostgreSQL's part of the connection editor's payload, from plain form values. The
// backend's form type is shared with MongoDB, so its settings are sent empty.
export function buildPostgresFields(v) {
  return {
    database:       v.database.trim() || null,
    connectionType: 'standalone',
    replicaSetName: null,
    options:        {},
    username:       v.username || null,
    password:       v.password || null,
    authDb:         null,
    authMechanism:  null,
    tlsCertKeyFile: null,
  }
}
