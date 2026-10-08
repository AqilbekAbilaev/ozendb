// MongoDB's entry in the engine table (engines/index.js).
import { buildMongoFields } from './connection/fields.js'
import { listDatabases } from './api/resources.js'
import { collectionStats, databaseStats } from './api/admin.js'

export const mongodb = Object.freeze({
  id: 'mongodb',
  defaultPort: 27017,
  // A MongoDB connection is to the server; it picks a database per query.
  namesDatabase: false,
  buildFields: buildMongoFields,
  // What the sidebar lists under a connection.
  loadResources: listDatabases,
  // The sidebar's stats card: a row carrying a collName is a collection, one without
  // is the database itself.
  statsTip: Object.freeze({
    kind: (target) => (target.collName ? 'collection' : 'database'),
    label: (target) => (target.collName ? `${target.dbName}.${target.collName}` : target.dbName),
    read: (target) => (target.collName
      ? collectionStats({ connectionId: target.connId, database: target.dbName, collection: target.collName })
      : databaseStats({ connectionId: target.connId, database: target.dbName })),
  }),
})
