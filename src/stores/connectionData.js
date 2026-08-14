import { ref } from 'vue'

// The databases the sidebar has fetched for each connection, keyed by connection id.
//
// Module-scope rather than local to ConnectionTree because it answers a question the
// connection editor also needs: is anything on screen still describing the server this
// connection currently points at? An entry here means the tree is showing databases
// fetched from that server, so repointing the connection elsewhere would leave what the
// user is looking at describing a machine it no longer talks to.
//
// The pool can't answer that — it's evicted on every save and refilled by any
// operation, so it goes cold while the tree carries on displaying what it already has.
export const connDatabases = ref({})   // connId → DatabaseInfo[]

/** Whether the sidebar currently holds databases fetched for this connection. */
export function hasLoadedData(id) {
  return !!connDatabases.value[id]
}
