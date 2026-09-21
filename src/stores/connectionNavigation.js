import { ref } from 'vue'
import { resourceFromTreeSelection } from '../utils/legacyResourceRef'

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

// The sidebar's single-click selection, at whatever level was clicked:
//   { connectionId, connectionName, dbName, collectionName, kind, resource } | null
// The native menu gates on it and menu actions act on it. The canonical ResourceRef
// rides alongside the flat fields, derived here where the clicked level is certain.
export const treeSelection = ref(null)

export function setTreeSelection(sel) {
  treeSelection.value = sel && { ...sel, resource: resourceFromTreeSelection(sel) }
}
