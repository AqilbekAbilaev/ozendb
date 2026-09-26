// MongoDB's part of the connection editor's payload, from plain form values.
export function buildMongoFields(v) {
  const auth = v.authMode !== 'none'
  return {
    connectionType: v.connType,
    replicaSetName: v.replicaSetName || null,
    options:        v.options,
    username:       auth ? (v.username || null) : null,
    password:       auth ? (v.password || null) : null,
    authDb:         auth ? (v.authDb || null) : null,
    authMechanism:  v.authMode,
    tlsCertKeyFile: v.useTls ? (v.tlsCertKeyFile || null) : null,
  }
}
