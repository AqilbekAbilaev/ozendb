// What each engine's connection editor shows: its tabs, the section for each of them,
// and the few strings and switches that differ. NewConnection.vue looks everything up
// here rather than branching on the engine.
import MongoServerFields from './mongodb/connection/MongoServerFields.vue'
import MongoAuthFields from './mongodb/connection/MongoAuthFields.vue'
import MongoSslFields from './mongodb/connection/MongoSslFields.vue'
import MongoAdvancedFields from './mongodb/connection/MongoAdvancedFields.vue'
import PostgresServerFields from './postgresql/connection/PostgresServerFields.vue'
import PostgresAuthFields from './postgresql/connection/PostgresAuthFields.vue'
import PostgresSslFields from './postgresql/connection/PostgresSslFields.vue'

// Tabs whose body is the same for every engine, so NewConnection.vue renders them itself.
export const SHARED_TABS = ['ssh', 'general']

const SERVER  = ['server', 'Server']
const AUTH    = ['auth', 'Authentication']
const SSH     = ['ssh', 'SSH Tunnel']
const SSL     = ['ssl', 'SSL']
const GENERAL = ['general', 'General']

export const CONNECTION_EDITORS = Object.freeze({
  mongodb: {
    tabs: [SERVER, AUTH, SSH, SSL, GENERAL, ['advanced', 'Advanced']],
    sections: {
      server: MongoServerFields,
      auth: MongoAuthFields,
      ssl: MongoSslFields,
      advanced: MongoAdvancedFields,
    },
    supportsUri: true,
    sshHint: 'Standalone connections only — replica set / SRV over SSH aren\'t supported yet.',
  },
  postgresql: {
    tabs: [SERVER, AUTH, SSH, SSL, GENERAL],
    sections: {
      server: PostgresServerFields,
      auth: PostgresAuthFields,
      ssl: PostgresSslFields,
    },
    // Pasting a postgresql:// connection string isn't parsed yet.
    supportsUri: false,
    sshHint: '',
  },
})
