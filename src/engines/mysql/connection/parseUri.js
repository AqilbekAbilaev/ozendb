// A mysql:// connection string as the connection editor's fields (see parseSqlUri).
// Besides MySQL's own ssl-mode and ssl-ca, it reads the spellings Connector/J and other
// clients write.
import { parseSqlUri } from '../../sql/connection/parseUri.js'
import { mysql } from '../engine.js'

const SSL_MODES = {
  disabled: [false, null], preferred: [false, null],
  required: [true, true], verify_ca: [true, false], verify_identity: [true, false],
}

export function parseMySqlUri(raw) {
  return parseSqlUri(raw, {
    schemes: ['mysql'],
    modeParams: ['ssl-mode', 'sslMode', 'sslmode'],
    caParams: ['ssl-ca', 'sslca', 'ssl_ca'],
    modes: SSL_MODES,
    // MySQL's own clients spell the modes in capitals but read them in any case.
    modeKey: (mode) => mode.toLowerCase(),
    defaultPort: mysql.defaultPort,
  })
}
