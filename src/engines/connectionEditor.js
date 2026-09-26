// Which fields each engine's connection editor shows, per tab. NewConnection.vue
// looks a section up here rather than branching on the engine.
import MongoServerFields from './mongodb/connection/MongoServerFields.vue'
import MongoAuthFields from './mongodb/connection/MongoAuthFields.vue'
import MongoSslFields from './mongodb/connection/MongoSslFields.vue'
import MongoAdvancedFields from './mongodb/connection/MongoAdvancedFields.vue'

export const CONNECTION_EDITORS = Object.freeze({
  mongodb: {
    sections: {
      server: MongoServerFields,
      auth: MongoAuthFields,
      ssl: MongoSslFields,
      advanced: MongoAdvancedFields,
    },
  },
})
