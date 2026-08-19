import { invoke } from '@tauri-apps/api/core'
import { listDatabases } from '../engines/mongodb/api/resources'
import { errText } from '../utils/errors'

// Clipboard paste for collections and databases, same-connection or cross-server. The
// add/drop/rename/duplicate dialogs used to live here too; each is now a component that
// owns its own form state (see constants/modalRegistry.js). `showToast` is injected so
// this stays UI-agnostic; `connectionTreeRef` refreshes the sidebar after a change;
// `dbClipboard` is read by pasteClipboard (App.vue still owns and sets it on copy).
export function useDbActions({ showToast, connectionTreeRef, dbClipboard }) {
  // Copy one collection from the clipboard's connection to the paste target. Same
  // connection uses the fast server-side `$out`; a different connection streams the
  // documents across via `copy_collection_to_connection`.
  async function copyOneCollection(clip, target, sourceCollection, targetCollection) {
    if (clip.connId === target.connId) {
      await invoke('copy_collection', {
        id: clip.connId,
        sourceDatabase: clip.dbName, sourceCollection: sourceCollection,
        targetDatabase: target.dbName, targetCollection: targetCollection,
      })
    } else {
      await invoke('copy_collection_to_connection', {
        sourceId: clip.connId, sourceDatabase: clip.dbName, sourceCollection: sourceCollection,
        targetId: target.connId, targetDatabase: target.dbName, targetCollection: targetCollection,
      })
    }
  }

  // Paste the app clipboard (a copied collection or database) into a target database,
  // on the same connection or a different one (cross-server).
  async function pasteClipboard(target) {
    const clip = dbClipboard.value
    if (!clip) { showToast('Nothing to paste — copy a collection or database first'); return }
    const crossServer = clip.connId !== target.connId
    try {
      if (clip.kind === 'collection') {
        await copyOneCollection(clip, target, clip.collName, clip.collName)
        showToast(`Pasted "${clip.collName}" into ${target.dbName}${crossServer ? ' (cross-server)' : ''}`)
      } else {
        const dbs = await listDatabases(clip.connId)
        const collections = (dbs.find(d => d.name === clip.dbName)?.collections) || []
        let done = 0
        for (const coll of collections) {
          try {
            await copyOneCollection(clip, target, coll, coll)
            done++
          } catch (_) { /* skip a collection that fails; report the rest */ }
        }
        showToast(`Pasted ${done} collection${done !== 1 ? 's' : ''} into ${target.dbName}${crossServer ? ' (cross-server)' : ''}`)
      }
      await connectionTreeRef.value.refreshConn(target.connId)
    } catch (e) {
      showToast('Paste failed: ' + errText(e))
    }
  }

  return {
    pasteClipboard: pasteClipboard,
  }
}
