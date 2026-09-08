import { ref } from 'vue'

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
