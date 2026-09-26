// The assembled `mongodb://` URI — the one MongoDB-only connection command.
// Engine-neutral connection CRUD is in appApi/.

import { invoke } from '@tauri-apps/api/core'
import { connectionPayload } from './payload'

export function connectionUri(id) {
  return invoke('connection_uri', connectionPayload(id))
}
