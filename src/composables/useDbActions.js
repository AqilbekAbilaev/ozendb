import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText } from '../utils/errors'
import { parsePipeline } from '../utils/queryParser'
import { tabs, pruneActiveTab } from '../stores/tabs'

// Collection/database CRUD-dialog state + confirm actions (add/drop/rename/duplicate
// collection & database & view & GridFS-bucket). `showToast` is injected so the
// composable stays UI-agnostic; the open tabs come from the store (drop and rename touch
// them); `connectionTreeRef` refreshes the sidebar after a change;
// `dbClipboard` is read by pasteClipboard (App.vue still owns and sets it on copy).
export function useDbActions({ showToast, connectionTreeRef, dbClipboard }) {
  const addCollectionTarget = ref(null)   // { connId, dbName } | null
  const newCollectionName   = ref('')
  const addCollectionError  = ref(null)
  const addCollectionSaving = ref(false)
  // Collection type + its options (mirrors 3T's Add Collection dialog). 'standard' sends
  // no options; 'capped'/'timeseries' send only their own fields. Kept as strings so the
  // inputs bind directly; coerced to numbers when the request is built.
  const newCollectionType   = ref('standard')  // 'standard' | 'capped' | 'timeseries' | 'clustered'
  const newCollectionOpts   = ref({
    size: '', max: '',                          // capped (bytes / document count)
    timeField: '', metaField: '', granularity: '', expireAfterSeconds: '',  // time-series
    clusteredIndexName: '',                     // clustered (optional index name)
  })

  const addViewTarget   = ref(null)       // { connId, dbName } | null
  const newViewName     = ref('')
  const newViewSource   = ref('')         // source collection the view reads from
  const newViewPipeline = ref('')         // aggregation pipeline (JSON array, optional)
  const addViewError    = ref(null)
  const addViewSaving   = ref(false)

  const addBucketTarget = ref(null)       // { connId, dbName } | null
  const newBucketName   = ref('')
  const addBucketError  = ref(null)
  const addBucketSaving = ref(false)

  const dropDatabaseTarget   = ref(null)  // { connId, dbName } | null
  const dropDatabaseError    = ref(null)
  const dropDatabaseDeleting = ref(false)

  const dropCollectionTarget   = ref(null)  // { connId, dbName, collName } | null
  const dropCollectionError    = ref(null)
  const dropCollectionDeleting  = ref(false)

  const renameCollectionTarget = ref(null)  // { connId, dbName, collName } | null
  const renameCollectionName   = ref('')
  const renameCollectionError  = ref(null)
  const renameCollectionSaving = ref(false)

  const duplicateCollectionTarget = ref(null)  // { connId, dbName, collName } | null
  const duplicateCollectionName   = ref('')
  const duplicateCollectionError  = ref(null)
  const duplicateCollectionSaving = ref(false)

  const addDatabaseTarget   = ref(null)  // { connId } | null
  const newDatabaseName     = ref('')
  const newDatabaseCollName = ref('')
  const addDatabaseError    = ref(null)
  const addDatabaseSaving   = ref(false)

  // Turn the dialog's string inputs into the backend `options` payload for the chosen
  // collection type. Returns undefined for a standard collection so the request stays
  // exactly as before. Throws a user-facing string when a required field is missing.
  function buildCollectionOptions() {
    const type = newCollectionType.value
    const opts = newCollectionOpts.value
    if (type === 'capped') {
      const size = Number(opts.size)
      if (!Number.isFinite(size) || size <= 0) throw 'Enter a maximum size in bytes for the capped collection.'
      const max = Number(opts.max)
      return {
        capped: true,
        size: size,
        max: Number.isFinite(max) && max > 0 ? max : null,
      }
    }
    if (type === 'timeseries') {
      const timeField = opts.timeField.trim()
      if (!timeField) throw 'Enter the time field for the time-series collection.'
      const expire = Number(opts.expireAfterSeconds)
      return {
        timeField: timeField,
        metaField: opts.metaField.trim() || null,
        granularity: opts.granularity.trim() || null,
        expireAfterSeconds: Number.isFinite(expire) && expire > 0 ? expire : null,
      }
    }
    if (type === 'clustered') {
      return {
        clustered: true,
        clusteredIndexName: opts.clusteredIndexName.trim() || null,
      }
    }
    return undefined
  }

  async function confirmAddCollection() {
    const target = addCollectionTarget.value
    const name = newCollectionName.value.trim()
    if (!target || !name) return
    let options
    try {
      options = buildCollectionOptions()
    } catch (msg) {
      addCollectionError.value = msg
      return
    }
    addCollectionSaving.value = true
    addCollectionError.value = null
    try {
      await invoke('create_collection', { id: target.connId, database: target.dbName, name: name, options: options })
      await connectionTreeRef.value.refreshConn(target.connId)
      showToast(`Collection "${name}" created`)
      addCollectionTarget.value = null
    } catch (e) {
      addCollectionError.value = errText(e)
    } finally {
      addCollectionSaving.value = false
    }
  }

  async function confirmAddView() {
    const target = addViewTarget.value
    const name = newViewName.value.trim()
    const source = newViewSource.value.trim()
    if (!target || !name || !source) return
    // Validate the (optional) pipeline up front so a typo surfaces before the round-trip.
    const pp = parsePipeline(newViewPipeline.value)
    if (!pp.ok) { addViewError.value = pp.error; return }
    addViewSaving.value = true
    addViewError.value = null
    try {
      await invoke('create_view', {
        id: target.connId,
        database: target.dbName,
        name: name,
        viewOn: source,
        pipeline: pp.ejson,
      })
      await connectionTreeRef.value.refreshConn(target.connId)
      showToast(`View "${name}" created`)
      addViewTarget.value = null
    } catch (e) {
      addViewError.value = errText(e)
    } finally {
      addViewSaving.value = false
    }
  }

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
        const dbs = await invoke('list_databases', { id: clip.connId })
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

  // Database → Add GridFS Bucket…: a bucket is the pair of `<name>.files` and
  // `<name>.chunks` collections; create both so it appears in the GridFS view.
  async function confirmAddBucket() {
    const target = addBucketTarget.value
    const name = newBucketName.value.trim()
    if (!target || !name) return
    addBucketSaving.value = true
    addBucketError.value = null
    try {
      for (const suffix of ['files', 'chunks']) {
        await invoke('create_collection', {
          id: target.connId,
          database: target.dbName,
          name: `${name}.${suffix}`,
        })
      }
      await connectionTreeRef.value.refreshConn(target.connId)
      showToast(`GridFS bucket "${name}" created`)
      addBucketTarget.value = null
    } catch (e) {
      addBucketError.value = errText(e)
    } finally {
      addBucketSaving.value = false
    }
  }

  async function confirmDropDatabase() {
    const target = dropDatabaseTarget.value
    if (!target) return
    dropDatabaseDeleting.value = true
    dropDatabaseError.value = null
    try {
      await invoke('drop_database', { id: target.connId, database: target.dbName })
      await connectionTreeRef.value.refreshConn(target.connId)
      tabs.value = tabs.value.filter(t => !(t.kind === 'collection' && t.connectionId === target.connId && t.dbName === target.dbName))
      pruneActiveTab()
      showToast(`Database "${target.dbName}" dropped`)
      dropDatabaseTarget.value = null
    } catch (e) {
      dropDatabaseError.value = errText(e)
    } finally {
      dropDatabaseDeleting.value = false
    }
  }

  async function confirmDropCollection() {
    const target = dropCollectionTarget.value
    if (!target) return
    dropCollectionDeleting.value = true
    dropCollectionError.value = null
    try {
      await invoke('drop_collection', { id: target.connId, database: target.dbName, collection: target.collName })
      await connectionTreeRef.value.refreshConn(target.connId)
      tabs.value = tabs.value.filter(t => !(t.kind === 'collection' && t.connectionId === target.connId && t.dbName === target.dbName && t.collectionName === target.collName))
      pruneActiveTab()
      showToast(`Collection "${target.collName}" dropped`)
      dropCollectionTarget.value = null
    } catch (e) {
      dropCollectionError.value = errText(e)
    } finally {
      dropCollectionDeleting.value = false
    }
  }

  async function confirmRenameCollection() {
    const target = renameCollectionTarget.value
    const newName = renameCollectionName.value.trim()
    if (!target || !newName || newName === target.collName) return
    renameCollectionSaving.value = true
    renameCollectionError.value = null
    try {
      await invoke('rename_collection', { id: target.connId, database: target.dbName, collection: target.collName, newName: newName })
      await connectionTreeRef.value.refreshConn(target.connId)
      const open = tabs.value.find(t => t.kind === 'collection' && t.connectionId === target.connId && t.dbName === target.dbName && t.collectionName === target.collName)
      if (open) {
        open.collectionName = newName
        open.title = newName
      }
      showToast(`Collection renamed to "${newName}"`)
      renameCollectionTarget.value = null
    } catch (e) {
      renameCollectionError.value = errText(e)
    } finally {
      renameCollectionSaving.value = false
    }
  }

  async function confirmDuplicateCollection() {
    const target = duplicateCollectionTarget.value
    const name = duplicateCollectionName.value.trim()
    if (!target || !name || name === target.collName) return
    duplicateCollectionSaving.value = true
    duplicateCollectionError.value = null
    try {
      const count = await invoke('duplicate_collection', {
        id: target.connId,
        database: target.dbName,
        source: target.collName,
        target: name,
      })
      await connectionTreeRef.value.refreshConn(target.connId)
      showToast(`Copied ${count} document${count === 1 ? '' : 's'} to "${name}"`)
      duplicateCollectionTarget.value = null
    } catch (e) {
      duplicateCollectionError.value = errText(e)
    } finally {
      duplicateCollectionSaving.value = false
    }
  }

  async function confirmAddDatabase() {
    const target = addDatabaseTarget.value
    const dbName = newDatabaseName.value.trim()
    const collName = newDatabaseCollName.value.trim()
    if (!target || !dbName || !collName) return
    addDatabaseSaving.value = true
    addDatabaseError.value = null
    try {
      await invoke('create_database', { id: target.connId, database: dbName, firstCollection: collName })
      await connectionTreeRef.value.refreshConn(target.connId)
      showToast(`Database "${dbName}" created`)
      addDatabaseTarget.value = null
    } catch (e) {
      addDatabaseError.value = errText(e)
    } finally {
      addDatabaseSaving.value = false
    }
  }

  // Dialog openers: seed a dialog's target + form fields from a clicked node, then
  // let AppModals render it. The matching confirm* handler above owns submit.
  function openAddCollection(node) {
    addCollectionTarget.value = { connId: node.connId, dbName: node.dbName }
    newCollectionName.value = ''
    newCollectionType.value = 'standard'
    newCollectionOpts.value = { size: '', max: '', timeField: '', metaField: '', granularity: '', expireAfterSeconds: '', clusteredIndexName: '' }
    addCollectionError.value = null
  }
  function openAddDatabase(node) {
    addDatabaseTarget.value = { connId: node.connId }
    newDatabaseName.value = ''
    newDatabaseCollName.value = ''
    addDatabaseError.value = null
  }
  // Add View… (database node) prefills no source; Add View Here… (collection node)
  // prefills the clicked collection. Both create a view in the same database.
  function openAddView(node, source) {
    addViewTarget.value = { connId: node.connId, dbName: node.dbName }
    newViewName.value = ''
    newViewSource.value = source
    newViewPipeline.value = ''
    addViewError.value = null
  }
  function openAddBucket(node) {
    addBucketTarget.value = { connId: node.connId, dbName: node.dbName }
    newBucketName.value = ''
    addBucketError.value = null
  }
  function openDropDatabase(node) {
    dropDatabaseTarget.value = { connId: node.connId, dbName: node.dbName }
    dropDatabaseError.value = null
  }
  function openDropCollection(node) {
    dropCollectionTarget.value = { connId: node.connId, dbName: node.dbName, collName: node.collName }
    dropCollectionError.value = null
  }
  function openRenameCollection(node) {
    renameCollectionTarget.value = { connId: node.connId, dbName: node.dbName, collName: node.collName }
    renameCollectionName.value = node.collName
    renameCollectionError.value = null
  }
  function openDuplicateCollection(node) {
    duplicateCollectionTarget.value = { connId: node.connId, dbName: node.dbName, collName: node.collName }
    duplicateCollectionName.value = node.collName + '_copy'
    duplicateCollectionError.value = null
  }

  return {
    addCollectionTarget: addCollectionTarget,
    newCollectionName: newCollectionName,
    newCollectionType: newCollectionType,
    newCollectionOpts: newCollectionOpts,
    addCollectionError: addCollectionError,
    addCollectionSaving: addCollectionSaving,
    addViewTarget: addViewTarget,
    newViewName: newViewName,
    newViewSource: newViewSource,
    newViewPipeline: newViewPipeline,
    addViewError: addViewError,
    addViewSaving: addViewSaving,
    addBucketTarget: addBucketTarget,
    newBucketName: newBucketName,
    addBucketError: addBucketError,
    addBucketSaving: addBucketSaving,
    dropDatabaseTarget: dropDatabaseTarget,
    dropDatabaseError: dropDatabaseError,
    dropDatabaseDeleting: dropDatabaseDeleting,
    dropCollectionTarget: dropCollectionTarget,
    dropCollectionError: dropCollectionError,
    dropCollectionDeleting: dropCollectionDeleting,
    renameCollectionTarget: renameCollectionTarget,
    renameCollectionName: renameCollectionName,
    renameCollectionError: renameCollectionError,
    renameCollectionSaving: renameCollectionSaving,
    duplicateCollectionTarget: duplicateCollectionTarget,
    duplicateCollectionName: duplicateCollectionName,
    duplicateCollectionError: duplicateCollectionError,
    duplicateCollectionSaving: duplicateCollectionSaving,
    addDatabaseTarget: addDatabaseTarget,
    newDatabaseName: newDatabaseName,
    newDatabaseCollName: newDatabaseCollName,
    addDatabaseError: addDatabaseError,
    addDatabaseSaving: addDatabaseSaving,
    confirmAddCollection: confirmAddCollection,
    confirmAddView: confirmAddView,
    confirmAddBucket: confirmAddBucket,
    confirmDropDatabase: confirmDropDatabase,
    confirmDropCollection: confirmDropCollection,
    confirmRenameCollection: confirmRenameCollection,
    confirmDuplicateCollection: confirmDuplicateCollection,
    confirmAddDatabase: confirmAddDatabase,
    pasteClipboard: pasteClipboard,
    openAddCollection: openAddCollection,
    openAddDatabase: openAddDatabase,
    openAddView: openAddView,
    openAddBucket: openAddBucket,
    openDropDatabase: openDropDatabase,
    openDropCollection: openDropCollection,
    openRenameCollection: openRenameCollection,
    openDuplicateCollection: openDuplicateCollection,
  }
}
