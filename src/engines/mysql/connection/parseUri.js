// A mysql:// connection string as the connection editor's fields. A field the string
// doesn't mention is null, so the form keeps its default. Null for a string the form
// can't hold: several hosts, or an ssl-mode it doesn't know.
const SSL_MODES = {
  disabled: [false, null], preferred: [false, null],
  required: [true, true], verify_ca: [true, false], verify_identity: [true, false],
}

export function parseMySqlUri(raw) {
  if (!raw.startsWith('mysql://')) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.hostname.includes(',')) return null
  // MySQL's own clients spell the modes in capitals but read them in any case.
  const mode = url.searchParams.get('ssl-mode')?.toLowerCase() ?? null
  if (mode !== null && !Object.hasOwn(SSL_MODES, mode)) return null
  const [tls, tlsAllowInvalidCerts] = mode === null ? [null, null] : SSL_MODES[mode]
  const text = (value) => (value ? decodeURIComponent(value) : null)
  return {
    username: text(url.username),
    password: text(url.password),
    hosts: [{ host: url.hostname.replace(/^\[(.*)\]$/, '$1') || 'localhost', port: Number(url.port) || 3306 }],
    database: text(url.pathname.slice(1)),
    tls,
    tlsAllowInvalidCerts,
    tlsCaFile: url.searchParams.get('ssl-ca'),
  }
}
