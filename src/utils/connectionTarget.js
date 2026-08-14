// Which server a connection reaches. Everything else a connection carries — its name,
// tag, credentials, TLS settings, timeouts — can be changed under a live connection
// safely: `update_connection` evicts the pooled client, so the next operation
// reconnects with the new settings and nothing already on screen is wrong.
//
// These fields are different. Change one and the databases and collections already
// listed in the sidebar describe a machine the connection no longer talks to, so a
// click on one of them would query a different server than the user is looking at.

function samePort(before, after) {
  // The form's port comes from a number input, so it may still be a string here;
  // `formFields` coerces it later.
  return Number(before) === Number(after)
}

function sameHosts(before, after) {
  const a = before ?? []
  const b = after ?? []
  if (a.length !== b.length) return false
  return a.every((host, i) => host.host === b[i].host && samePort(host.port, b[i].port))
}

/**
 * Whether an edit moves the connection to a different server.
 *
 * @param {Object} before - the stored connection (snake_case, as persisted).
 * @param {Object} after - the editor's form fields (camelCase, as `formFields` emits).
 * @returns {boolean} true when the target changed.
 */
export function connectionTargetChanged(before, after) {
  if (!sameHosts(before.hosts, after.hosts)) return true
  if (before.connection_type !== after.connectionType) return true
  if ((before.replica_set_name || '') !== (after.replicaSetName || '')) return true

  // A tunnel decides which machine the driver actually reaches, so its endpoint counts
  // as part of the target — but only while the tunnel is in use.
  if (!!before.ssh_enabled !== !!after.sshEnabled) return true
  if (after.sshEnabled) {
    if ((before.ssh_host || '') !== (after.sshHost || '')) return true
    if (!samePort(before.ssh_port, after.sshPort)) return true
  }

  return false
}
