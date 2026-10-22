// A SQL engine's connection string as the connection editor's fields. A field the string
// doesn't mention is null, so the form keeps its default. Null for a string the form can't
// hold: another scheme, several hosts, an SSL mode it doesn't know, or a broken percent escape.
//
// What differs between engines is data: the schemes, the parameters that may carry the SSL
// mode and the CA file (the first one present wins), the mode table, how a mode is spelled
// before it is looked up in that table, and the port when the string names none.
export function parseSqlUri(raw, { schemes, modeParams, caParams, modes, modeKey, defaultPort }) {
  if (!schemes.some((scheme) => raw.startsWith(`${scheme}://`))) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.hostname.includes(',')) return null
  const param = (names) => names.map((name) => url.searchParams.get(name)).find((value) => value !== null) ?? null
  const mode = param(modeParams)
  if (mode !== null && !Object.hasOwn(modes, modeKey(mode))) return null
  const [tls, tlsAllowInvalidCerts] = mode === null ? [null, null] : modes[modeKey(mode)]
  const text = (value) => (value ? decodeURIComponent(value) : null)
  try {
    return {
      username: text(url.username),
      password: text(url.password),
      hosts: [{ host: url.hostname.replace(/^\[(.*)\]$/, '$1') || 'localhost', port: Number(url.port) || defaultPort }],
      database: text(url.pathname.slice(1)),
      tls,
      tlsAllowInvalidCerts,
      tlsCaFile: param(caParams),
    }
  } catch {
    return null
  }
}
