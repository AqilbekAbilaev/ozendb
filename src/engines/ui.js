// The component half of the engine table (engines/index.js), for components only:
// what each engine's connection editor shows, and its own sidebar rows.
import MongoServerFields from './mongodb/connection/MongoServerFields.vue'
import MongoAuthFields from './mongodb/connection/MongoAuthFields.vue'
import MongoSslFields from './mongodb/connection/MongoSslFields.vue'
import MongoAdvancedFields from './mongodb/connection/MongoAdvancedFields.vue'
import SqlServerFields from './sql/connection/SqlServerFields.vue'
import SqlAuthFields from './sql/connection/SqlAuthFields.vue'
import SqlSslFields from './sql/connection/SqlSslFields.vue'
import { parsePostgresUri } from './postgresql/connection/parseUri.js'
import { parseMySqlUri } from './mysql/connection/parseUri.js'
import { parseConnectionUri } from '../utils/connectionUri.js'
import { KNOWN_OPTION_KEYS } from '../data/connectionOptions.js'
import MongoTreeNodes from './mongodb/tree/MongoTreeNodes.vue'
import PostgresTreeNodes from './postgresql/tree/PostgresTreeNodes.vue'
import MySqlTreeNodes from './mysql/tree/MySqlTreeNodes.vue'

// Tabs whose body is the same for every engine, so NewConnection.vue renders them itself.
export const SHARED_TABS = ['ssh', 'general']

const SERVER  = ['server', 'Server']
const AUTH    = ['auth', 'Authentication']
const SSH     = ['ssh', 'SSH Tunnel']
const SSL     = ['ssl', 'SSL']
const GENERAL = ['general', 'General']

// Each connection editor's tabs, the section for each of them, and the few strings and
// switches that differ. NewConnection.vue looks everything up here.
export const CONNECTION_EDITORS = Object.freeze({
  mongodb: {
    tabs: [SERVER, AUTH, SSH, SSL, GENERAL, ['advanced', 'Advanced']],
    sections: {
      server: MongoServerFields,
      auth: MongoAuthFields,
      ssl: MongoSslFields,
      advanced: MongoAdvancedFields,
    },
    // A pasted connection string as the form's fields, or null when it isn't one.
    parseUri: (raw) => parseConnectionUri(raw, KNOWN_OPTION_KEYS),
    uriExample: 'mongodb+srv://user:password@cluster.mongodb.net/',
    uriRefusal: 'That doesn’t look like a MongoDB connection string (expected mongodb:// or mongodb+srv://).',
    sshHint: 'Standalone connections only — replica set / SRV over SSH aren\'t supported yet.',
  },
  postgresql: {
    tabs: [SERVER, AUTH, SSH, SSL, GENERAL],
    sections: {
      server: SqlServerFields,
      auth: SqlAuthFields,
      ssl: SqlSslFields,
    },
    parseUri: parsePostgresUri,
    uriExample: 'postgresql://user:password@host:5432/database?sslmode=require',
    uriRefusal: 'That doesn’t look like a PostgreSQL connection string this editor can hold (expected postgresql:// with one host).',
    sshHint: '',
  },
  mysql: {
    tabs: [SERVER, AUTH, SSH, SSL, GENERAL],
    sections: {
      server: SqlServerFields,
      auth: SqlAuthFields,
      ssl: SqlSslFields,
    },
    parseUri: parseMySqlUri,
    uriExample: 'mysql://user:password@host:3306/database?ssl-mode=REQUIRED',
    uriRefusal: 'That doesn’t look like a MySQL connection string this editor can hold (expected mysql:// with one host).',
    sshHint: '',
  },
})

// An engine's rows under an expanded connection in the sidebar. ConnectionTree.vue draws
// the connection row itself and hands everything below it to these.
export const TREE_NODES = Object.freeze({
  mongodb: MongoTreeNodes,
  postgresql: PostgresTreeNodes,
  mysql: MySqlTreeNodes,
})
