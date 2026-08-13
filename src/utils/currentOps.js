// Pure list maths for the Current Operations tab: turning a `currentOp` reply into the
// rows the table draws, and keeping ops that have finished on screen for a moment.

// Fields every command carries that describe the session rather than the work — they'd
// crowd the actual query out of a one-line cell.
const COMMAND_NOISE = ['lsid', '$db', '$readPreference', '$clusterTime', 'signature']
const COMMAND_MAX = 120

// A one-line rendering of the op's command for the table. The whole document is a click
// away in the JSON and Tree views, so this only has to be recognisable.
function commandSummary(command) {
  if (!command || typeof command !== 'object') return ''
  const text = JSON.stringify(command, (key, value) => (COMMAND_NOISE.includes(key) ? undefined : value))
  if (!text || text === '{}') return ''
  return text.length > COMMAND_MAX ? text.slice(0, COMMAND_MAX) + '…' : text
}

// One row per in-progress operation. `raw` is kept whole so the pane can show the
// original document for the selected op.
export function normalizeOps(reply) {
  const inprog = reply && Array.isArray(reply.inprog) ? reply.inprog : []
  return inprog.map((op) => ({
    key: String(op.opid ?? ''),
    opid: op.opid ?? null,
    type: op.op || '',
    ns: op.ns || '',
    secs: op.secs_running != null ? Number(op.secs_running) : 0,
    desc: op.desc || '',
    client: op.client || '',
    // The run id the query runner stamps on every find/aggregate, which is what ties a
    // row here back to a query tab in this app.
    comment: (op.command && op.command.comment) || '',
    // Why an op is slow: the plan it chose, whether it's blocked, how hard it's been
    // fighting for the server, and who is running it.
    plan: op.planSummary || '',
    app: op.appName || (op.clientMetadata && op.clientMetadata.driver && op.clientMetadata.driver.name) || '',
    user: (op.effectiveUsers && op.effectiveUsers[0] && op.effectiveUsers[0].user) || '',
    yields: op.numYields ?? 0,
    waiting: !!op.waitingForLock,
    command: commandSummary(op.command),
    // Server housekeeping (Checkpointer, JournalFlusher…) runs on no client connection.
    sys: op.connectionId == null,
    expiredAt: null,
    raw: op,
  }))
}

// Whittle the list down to what the toolbar asks for. `showSys` is a client-side filter
// as well as a server flag, because the internal threads are reported either way.
export function filterOps(rows, { dbName, collName, slowOnly, slowSecs, showSys } = {}) {
  const prefix = dbName ? (collName ? `${dbName}.${collName}` : `${dbName}.`) : ''
  return rows.filter((op) => {
    if (!showSys && op.sys) return false
    if (prefix && !(collName ? op.ns === prefix : op.ns.startsWith(prefix))) return false
    // A retained op has stopped running, so its last-seen duration is not something the
    // live threshold can fairly judge.
    if (slowOnly && !op.expiredAt && op.secs < (slowSecs || 0)) return false
    return true
  })
}

// Merge a fresh poll into what's on screen. An op the server no longer reports is not
// removed straight away — a query that takes less than one poll interval would otherwise
// never be seen at all — it's stamped `expiredAt` and kept for `retainMs`.
export function mergeRetained(prev, next, retainMs, now) {
  const arriving = new Map(next.map((op) => [op.key, op]))
  const merged = []

  for (const old of prev) {
    const still = arriving.get(old.key)
    if (still) {
      merged.push({ ...still, expiredAt: null })
      arriving.delete(old.key)
      continue
    }
    // Stamp the moment it went, not this poll, so the countdown runs from the disappearance.
    const expiredAt = old.expiredAt ?? now
    if (now - expiredAt < retainMs) merged.push({ ...old, expiredAt: expiredAt })
  }

  for (const op of arriving.values()) merged.push(op)
  return merged
}
