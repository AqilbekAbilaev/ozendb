import { ref } from 'vue'
import { sameResource, isResourceAncestor } from '../utils/resourceRef'

// A request is consumed by the tree after it opens the matching connection. The nonce
// makes two requests for the same connection distinct, which matters when a caller asks
// to reveal a connection that is already the most recent request.
export const connectionOpenRequest = ref(null)

let requestNonce = 0

export function requestConnectionOpen(connectionId) {
  const request = { connectionId, nonce: ++requestNonce }
  connectionOpenRequest.value = request
  return request
}

export function consumeConnectionOpenRequest() {
  const request = connectionOpenRequest.value
  connectionOpenRequest.value = null
  return request
}

// The sidebar's single-click selection, at whatever level was clicked, or null. Every
// selection carries the row's `resource`, built by the tree where the clicked level is
// certain, plus `connectionName` and `engine`. A MongoDB selection is just that; a
// PostgreSQL one also keeps the fields its consumers read (connectionId, database,
// schema, table, kind). The native menu gates on it and menu actions act on it.
export const treeSelection = ref(null)

export function setTreeSelection(sel) {
  treeSelection.value = sel
}

// Called beside closeWhere(affectedByResource(drop)) so a dropped node, or one inside it,
// doesn't stay selected for the native menu to act on (#154).
export function clearTreeSelectionUnder(drop) {
  const sel = treeSelection.value?.resource
  if (sel && (sameResource(sel, drop) || isResourceAncestor(drop, sel))) treeSelection.value = null
}
