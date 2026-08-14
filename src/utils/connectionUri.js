// Routing for connection-string query parameters when importing a URI in the New
// Connection dialog. Studio 3T preserves *every* option from an imported string; our
// editor has three destinations for them — the Advanced-tab catalog (known keys), a few
// dedicated fields (read preference, TLS file paths), and a verbatim "extra" bucket for
// anything else — so nothing is silently dropped.

// The editor's short names for the mechanisms the connection string spells out in full.
const MECHANISM_SHORT_NAMES = {
  'MONGODB-X509': 'X509',
  'MONGODB-AWS': 'AWS',
  'MONGODB-OIDC': 'OIDC',
}

// Params that structural parsing already consumes into their own fields, matched
// case-insensitively so they aren't also treated as passthrough options.
const STRUCTURAL_KEYS = [
  'replicaSet', 'authSource', 'authMechanism',
  'tls', 'ssl', 'tlsAllowInvalidCertificates',
]

/**
 * Split a URI's options into the editor's destinations.
 * @param {URLSearchParams} params - the parsed query string.
 * @param {string[]} knownKeys - catalog keys (KNOWN_OPTION_KEYS) the Advanced tab models.
 * @returns {{ known: Object, extra: Object, readPreference: (string|null),
 *            tlsCaFile: (string|null), tlsCertKeyFile: (string|null), tls: boolean }}
 *   `known` is keyed by canonical catalog key; `extra` keeps unrecognized keys verbatim.
 */
export function partitionUriOptions(params, knownKeys) {
  const knownByLower = new Map(knownKeys.map(key => [key.toLowerCase(), key]))
  const structuralLower = new Set(STRUCTURAL_KEYS.map(key => key.toLowerCase()))

  const result = {
    known: {},
    extra: {},
    readPreference: null,
    tlsCaFile: null,
    tlsCertKeyFile: null,
    tls: false,
  }

  for (const [rawKey, value] of params.entries()) {
    const lower = rawKey.toLowerCase()
    if (structuralLower.has(lower)) continue

    if (lower === 'readpreference') {
      result.readPreference = value
      continue
    }
    if (lower === 'tlscafile' || lower === 'sslcertificateauthorityfile') {
      result.tlsCaFile = value
      result.tls = true
      continue
    }
    if (lower === 'tlscertificatekeyfile' || lower === 'sslpemkeyfile') {
      result.tlsCertKeyFile = value
      result.tls = true
      continue
    }

    const canonical = knownByLower.get(lower)
    if (canonical) {
      result.known[canonical] = value
    } else {
      result.extra[rawKey] = value
    }
  }

  return result
}

function decode(text) {
  try {
    return decodeURIComponent(text)
  } catch (_) {
    return text
  }
}

// Split the comma-separated seed list. `host:port` splits at the LAST ':' so an IPv6
// literal keeps its own; SRV carries a single hostname and no port.
function parseHosts(hostsPart, isSrv) {
  const list = hostsPart.split(',').filter(Boolean)
  if (isSrv) return [{ host: list[0] || 'localhost', port: 27017 }]
  if (!list.length) return [{ host: 'localhost', port: 27017 }]

  return list.map((entry) => {
    const colon = entry.lastIndexOf(':')
    if (colon === -1 || entry.includes(']')) return { host: entry || 'localhost', port: 27017 }
    return {
      host: entry.slice(0, colon) || 'localhost',
      port: parseInt(entry.slice(colon + 1)) || 27017,
    }
  })
}

// `ENVIRONMENT:azure,TOKEN_RESOURCE:api://abc` → the two OIDC fields. Each pair splits on
// its FIRST colon so a resource value containing one (a URL) survives intact.
function parseMechanismProperties(raw) {
  const out = { oidcEnvironment: 'azure', oidcTokenResource: null }
  for (const part of raw.split(',')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const key = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (key === 'ENVIRONMENT' && value) out.oidcEnvironment = value
    if (key === 'TOKEN_RESOURCE') out.oidcTokenResource = value
  }
  return out
}

/**
 * Parse a pasted MongoDB connection string into the New Connection form's fields.
 *
 * Hand-rolled rather than using the browser's URL parser, which throws on a multi-host
 * seed list (`host1,host2,…`) — the standard replica-set / cluster format.
 *
 * `null` for a field means the string said nothing about it, so the form should keep
 * whatever it already holds; that distinction matters for credentials and for the auth
 * mechanism, whose default lives in the editor rather than here.
 *
 * @param {string} raw - the pasted connection string.
 * @param {string[]} knownKeys - catalog keys (KNOWN_OPTION_KEYS) the Advanced tab models.
 * @returns {Object|null} the parsed fields, or null if `raw` isn't a MongoDB URI.
 */
export function parseConnectionUri(raw, knownKeys) {
  const scheme = raw.match(/^mongodb(\+srv)?:\/\//)
  if (!scheme) return null

  const isSrv = !!scheme[1]
  let rest = raw.slice(scheme[0].length)

  // Peel off the query string, then the optional /database path, then the userinfo —
  // in that order, so a '/' or '@' inside the query can't be mistaken for a delimiter.
  let queryStr = ''
  const question = rest.indexOf('?')
  if (question !== -1) {
    queryStr = rest.slice(question + 1)
    rest = rest.slice(0, question)
  }

  let dbPath = ''
  const slash = rest.indexOf('/')
  if (slash !== -1) {
    dbPath = rest.slice(slash + 1)
    rest = rest.slice(0, slash)
  }

  // Split userinfo from hosts at the LAST '@', so an unescaped '@' in a password is
  // tolerated — the host portion never contains one.
  let userInfo = ''
  let hostsPart = rest
  const at = rest.lastIndexOf('@')
  if (at !== -1) {
    userInfo = rest.slice(0, at)
    hostsPart = rest.slice(at + 1)
  }

  let username = null
  let password = null
  if (userInfo) {
    const colon = userInfo.indexOf(':')
    username = decode(colon === -1 ? userInfo : userInfo.slice(0, colon))
    password = colon === -1 ? '' : decode(userInfo.slice(colon + 1))
  }

  const params = new URLSearchParams(queryStr)
  const replicaSetName = params.get('replicaSet')
  const mechanism = params.get('authMechanism')

  let authMode = null
  if (mechanism) {
    authMode = MECHANISM_SHORT_NAMES[mechanism] || mechanism
  } else if (!username) {
    authMode = 'none'
  }

  const oidc = authMode === 'OIDC'
    ? parseMechanismProperties(params.get('authMechanismProperties') || '')
    : { oidcEnvironment: null, oidcTokenResource: null }

  const routed = partitionUriOptions(params, knownKeys)
  const tls = params.get('tls') === 'true' || params.get('ssl') === 'true' || routed.tls

  return {
    username: username,
    password: password,
    hosts: parseHosts(hostsPart, isSrv),
    connectionType: replicaSetName ? 'replica' : (isSrv ? 'srv' : 'standalone'),
    replicaSetName: replicaSetName,
    authDb: params.get('authSource') || decode(dbPath) || 'admin',
    authMode: authMode,
    oidcEnvironment: oidc.oidcEnvironment,
    oidcTokenResource: oidc.oidcTokenResource,
    tls: tls || null,
    tlsAllowInvalidCerts: params.get('tlsAllowInvalidCertificates') === 'true' || null,
    tlsCaFile: routed.tlsCaFile,
    tlsCertKeyFile: routed.tlsCertKeyFile,
    readPreference: routed.readPreference,
    advancedOptions: routed.known,
    extraOptions: routed.extra,
  }
}
