// MongoDB's part of the connection editor's payload, from the form's shared values and
// MongoDB's own (useMongoFields' values()), all plain values.
export function buildMongoFields(v, mongo) {
  const auth = mongo.authMode !== 'none'
  return {
    connectionType: mongo.connType,
    replicaSetName: mongo.replicaSetName || null,
    options:        mongo.options,
    username:       auth ? (v.username || null) : null,
    password:       auth ? (v.password || null) : null,
    authDb:         auth ? (mongo.authDb || null) : null,
    authMechanism:  mongo.authMode,
    tlsCertKeyFile: v.useTls ? (mongo.tlsCertKeyFile || null) : null,
  }
}
