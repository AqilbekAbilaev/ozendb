// A postgresql:// connection string as the connection editor's fields (see parseSqlUri).
import { parseSqlUri } from '../../sql/connection/parseUri.js'
import { postgresql } from '../engine.js'

const SSL_MODES = {
  disable: [false, null], allow: [false, null], prefer: [false, null],
  require: [true, true], 'verify-ca': [true, false], 'verify-full': [true, false],
}

export function parsePostgresUri(raw) {
  return parseSqlUri(raw, {
    schemes: ['postgresql', 'postgres'],
    modeParams: ['sslmode'],
    caParams: ['sslrootcert'],
    modes: SSL_MODES,
    // PostgreSQL's sslmode names are matched exactly as written.
    modeKey: (mode) => mode,
    defaultPort: postgresql.defaultPort,
  })
}
