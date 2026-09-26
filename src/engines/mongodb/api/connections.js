// The MongoDB-only connection commands: an SSH tunnel test that pings MongoDB, and
// the assembled `mongodb://` URI. Engine-neutral connection CRUD is in appApi/.

import { invoke } from '@tauri-apps/api/core'
import { connectionPayload } from './payload'

export function testSshConnection(fields) {
  return invoke('test_ssh_connection', fields)
}

export function connectionUri(id) {
  return invoke('connection_uri', connectionPayload(id))
}
