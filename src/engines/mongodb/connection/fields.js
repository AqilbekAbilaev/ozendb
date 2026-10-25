// MongoDB's part of the connection editor's payload, from the form's shared values and
// MongoDB's own fields (useMongoFields).
export function buildMongoFields(v, mongo) {
  const auth = mongo.authMode.value !== 'none'
  return {
    connectionType: mongo.connType.value,
    replicaSetName: mongo.replicaSetName.value || null,
    options:        mongo.buildOptions(),
    username:       auth ? (v.username || null) : null,
    password:       auth ? (v.password || null) : null,
    authDb:         auth ? (mongo.authDb.value || null) : null,
    authMechanism:  mongo.authMode.value,
    tlsCertKeyFile: v.useTls ? (mongo.tlsCertKeyFile.value || null) : null,
  }
}
