import { listDatabases } from '../engines/mongodb/api/resources'
import { showToast } from '../stores/toast'
import { dbClipboard } from '../stores/dbClipboard'
import { copyCollection, copyCollectionToConnection } from '../engines/mongodb/api/transfer'
import { errText } from '../utils/errors'
import { resourceName } from '../utils/resourceRef'
import { invalidateConnectionResources } from '../stores/connectionData'

// Clipboard paste for collections and databases, same-connection or cross-server. The
// add/drop/rename/duplicate dialogs used to live here too; each is now a component that
// owns its own form state (see constants/modalRegistry.js). `showToast` is injected so
// this stays UI-agnostic; the resource store refreshes after a change;
export function useDbActions() {
  // Both clipboard kinds carry their database as the first segment: a copied database is
  // that segment, a copied collection sits under it. The paste target is always a
  // database, so its own name is the last segment's.
  const databaseOf = (ref) => ref.segments[0].name

  // Copy one collection from the clipboard's connection to the paste target. Same
  // connection uses the fast server-side `$out`; a different connection streams the
  // documents across via `copy_collection_to_connection`.
  async function copyOneCollection(clip, target, sourceCollection, targetCollection) {
    const from = { database: databaseOf(clip.resource), collection: sourceCollection }
    const into = { database: resourceName(target.resource), collection: targetCollection }
    if (clip.resource.connectionId === target.resource.connectionId) {
      await copyCollection(clip.resource.connectionId, from, into)
    } else {
      await copyCollectionToConnection(
        clip.resource.connectionId, from, target.resource.connectionId, into,
      )
    }
    invalidateConnectionResources(target.resource.connectionId)
  }

  // Paste the app clipboard (a copied collection or database) into a target database,
  // on the same connection or a different one (cross-server).
  async function pasteClipboard(target) {
    const clip = dbClipboard.value
    if (!clip) { showToast('Nothing to paste — copy a collection or database first'); return }
    const crossServer = clip.resource.connectionId !== target.resource.connectionId
    const into = resourceName(target.resource)
    try {
      if (clip.kind === 'collection') {
        const name = resourceName(clip.resource)
        await copyOneCollection(clip, target, name, name)
        showToast(`Pasted "${name}" into ${into}${crossServer ? ' (cross-server)' : ''}`)
      } else {
        const dbs = await listDatabases(clip.resource.connectionId)
        const collections = (dbs.find(d => d.name === databaseOf(clip.resource))?.collections) || []
        let done = 0
        for (const coll of collections) {
          try {
            await copyOneCollection(clip, target, coll, coll)
            done++
          } catch (_) { /* skip a collection that fails; report the rest */ }
        }
        showToast(`Pasted ${done} collection${done !== 1 ? 's' : ''} into ${into}${crossServer ? ' (cross-server)' : ''}`)
      }
    } catch (e) {
      showToast('Paste failed: ' + errText(e))
    }
  }

  return {
    pasteClipboard: pasteClipboard,
  }
}
