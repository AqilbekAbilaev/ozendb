// A postgresql:// connection string as the connection editor's fields. A field the
// string doesn't mention is null, so the form keeps its default. Null for a string the
// form can't hold: several hosts, or an sslmode it doesn't know.
const SSL_MODES = {
  disable: [false, null], allow: [false, null], prefer: [false, null],
  require: [true, true], 'verify-ca': [true, false], 'verify-full': [true, false],
}

export function parsePostgresUri(raw) {
  if (!/^postgres(ql)?:\/\//.test(raw)) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.hostname.includes(',')) return null
  const mode = url.searchParams.get('sslmode')
  if (mode !== null && !(mode in SSL_MODES)) return null
  const [tls, tlsAllowInvalidCerts] = mode === null ? [null, null] : SSL_MODES[mode]
  const text = (value) => (value ? decodeURIComponent(value) : null)
  return {
    username: text(url.username),
    password: text(url.password),
    hosts: [{ host: url.hostname.replace(/^\[(.*)\]$/, '$1') || 'localhost', port: Number(url.port) || 5432 }],
    database: text(url.pathname.slice(1)),
    tls,
    tlsAllowInvalidCerts,
    tlsCaFile: url.searchParams.get('sslrootcert'),
  }
}
