// Tauri commands reject with a serialized AppError, now shaped as
// { code, message } (see src-tauri/src/error.rs). These helpers read that shape
// while staying robust to a plain string (older payloads) or a thrown JS Error,
// so a single call site works for any rejection value.

export function errMessage(e) {
  if (e == null) return 'Unknown error'
  if (typeof e === 'string') return e
  if (typeof e.message === 'string') return e.message
  return String(e)
}

export function errCode(e) {
  if (e && typeof e === 'object' && typeof e.code === 'string') return e.code
  return null
}

// Friendly primary titles for the error codes whose backend `message` is the
// database driver's raw internal dump (server-selection topology, auth-failure
// detail, …). Codes we author ourselves (validation, bson, unreachable,
// unknown_connection, sql, ssh, keychain) already carry readable messages, so
// they are intentionally absent and callers fall back to the raw message —
// `command` too: a rejected command carries the server's own errmsg, which says
// far more than any title we could write ("a group specification must include an _id").
// `read_only` is the one self-authored exception: its message is already
// readable, but a distinct title makes a blocked write unmistakable in the toast.
const FRIENDLY_TITLES = {
  auth:      'Authentication failed',
  network:   "Can't reach the server",
  tls:       'TLS / SSL connection problem',
  mongo:     'The database reported an error',
  read_only: 'Connection is read-only',
}

// A calm, human title for an error code, or '' when we have none for it (the
// caller should then show the raw message). Kept here so every error surface —
// the shared StateMessage placeholder and the connection tree's inline errors —
// presents the same wording.
export function errTitle(code) {
  return code ? (FRIENDLY_TITLES[code] || '') : ''
}

// A calm, one-line error string for surfaces without a "Details" disclosure —
// toasts and inline modal error areas. Prefers the friendly title for any code
// that has one, so the driver's raw internal dumps (server-selection topology,
// verbose auth detail) never face the user. Codes we author ourselves have no
// friendly title and fall through to their already-readable raw message.
export function errText(e) {
  return errTitle(errCode(e)) || errMessage(e)
}
