/**
 * Apply an edited connection to a list of connections.
 *
 * The entry is replaced wholesale, since the event carries the connection's complete
 * new state. A connection that isn't in the list is ignored rather than appended: the
 * sidebar holds only the connections that are open, and editing a closed one must not
 * make it appear there.
 *
 * @param {Object[]} list - the current connections.
 * @param {Object} conn - the edited connection, carrying its `id`.
 * @returns {Object[]} a new list; the input is left untouched.
 */
export function applyConnectionUpdate(list, conn) {
  return list.map(entry => (entry.id === conn.id ? conn : entry))
}
