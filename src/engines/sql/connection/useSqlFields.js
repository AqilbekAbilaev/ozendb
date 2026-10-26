import { ref } from 'vue'

/**
 * A SQL engine's half of a connection editor: the database the connection names. Part
 * of one editor, so the refs are per-instance.
 *
 * @param {Object|null} editConn - the connection being edited, or null when creating.
 */
export function useSqlFields(editConn) {
  const database = ref(editConn ? (editConn.database ?? '') : '')

  // A SQL engine's part of a parsed connection string. A null database means the
  // string named none, so the field keeps what it holds.
  function applyParsed(parsed) {
    if (parsed.database !== null) database.value = parsed.database
  }

  // What the payload is built from (buildSqlFields), as plain values.
  function values() {
    return { database: database.value }
  }

  return { database, applyParsed, values }
}
