// Tauri events. Their names are strings the two sides must agree on, exactly like
// command names, so they live here for the same reason commands sit behind appApi: a
// misspelt one fails silently. Each subscriber returns listen()'s promise of an
// unlisten function and hands its handler the payload alone.

import { listen, emit } from '@tauri-apps/api/event'

const subscribe = (name) => (handler) => listen(name, (e) => handler(e.payload))

// Raised by the backend (the names are pinned in src-tauri/src/events.rs).
export const onMenuAction        = subscribe('menu-action')
export const onOperationsChanged = subscribe('operations-changed')
export const onDocumentTarget    = subscribe('document-target')
export const onSshHostKeyPrompt  = subscribe('ssh-host-key-prompt')
export const onSshHostKeyChanged = subscribe('ssh-host-key-changed')

// Raised by the frontend for its other window and its other components.
export const onDocumentSaved     = subscribe('document-saved')
export const onConnectionSaved   = subscribe('connection-saved')
export const onConnectionUpdated = subscribe('connection-updated')
export const onConnectionDeleted = subscribe('connection-deleted')

export const emitDocumentSaved     = (payload) => emit('document-saved', payload)
export const emitConnectionSaved   = (conn) => emit('connection-saved', conn)
export const emitConnectionUpdated = (conn) => emit('connection-updated', conn)
export const emitConnectionDeleted = (payload) => emit('connection-deleted', payload)
