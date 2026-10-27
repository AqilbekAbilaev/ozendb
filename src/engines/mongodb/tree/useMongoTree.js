import { computed, ref, watch } from 'vue'
import { appendResource, createResourceRef, resourceAt } from '../../../utils/resourceRef'
import { nodeTagKey } from '../../../utils/tabColor'
import { workspaceIsCollection } from '../../../workspaces/registry'
import { activeTab } from '../../../stores/tabs'
import { openConnections } from '../../../stores/openConnections'
import { treeSelection, setTreeSelection } from '../../../stores/connectionNavigation'
import { openCollectionTab } from '../../../stores/tabCreators'

const databaseRef = (connectionId, database) => createResourceRef(connectionId, [{ kind: 'database', name: database }])
const collectionRef = (connectionId, database, collection) => appendResource(databaseRef(connectionId, database), 'collection', collection)

// A database or collection row's key, built from its ref by nodeTagKey: the one spelling
// the colour tags, the right-click highlight, the active row and the open databases are
// all compared in, so no two of them can drift apart.
const databaseKey = (connectionId, database) => nodeTagKey(databaseRef(connectionId, database))
const collectionKey = (connectionId, database, collection) => nodeTagKey(collectionRef(connectionId, database, collection))

// connection id → { database key → open }. Module scope rather than the composable's, so
// a connection's rows can be torn down on collapse and find their databases as they left
// them when drawn again. Like the stores' refs, it does not survive Vite HMR cleanly.
const openDatabases = ref({})

// Forgotten when the connection leaves the open list, whoever closed it and whether or not
// its rows are on screen. Synchronous, as the shared tree's pruning is: it only drops keys.
watch(openConnections, (list) => {
  const live = new Set(list.map(c => c.id))
  for (const id of Object.keys(openDatabases.value)) {
    if (!live.has(id)) delete openDatabases.value[id]
  }
}, { flush: 'sync' })

function setDatabaseOpen(connectionId, key, open) {
  openDatabases.value[connectionId] ??= {}
  openDatabases.value[connectionId][key] = open
}

// The shared tree expands the active tab's connection; its database is opened here, so
// the highlighted collection row is on screen rather than under a closed database. Module
// scope too, since each connection's rows call useMongoTree and a collapsed one has none.
watch(activeTab, (tab) => {
  if (!workspaceIsCollection(tab)) return
  const { connectionId } = tab.target
  if (!openConnections.value.some(c => c.id === connectionId)) return  // not in the sidebar
  setDatabaseOpen(connectionId, nodeTagKey(resourceAt(tab.target, 'database')), true)
})

/** The sidebar's MongoDB rows: which databases are open, and what clicking a row does. */
export function useMongoTree() {
  // The collection row highlighted by a single click — derived, since the selection can
  // also be cleared from outside the tree (opening it from the toolbar).
  const selectedKey = computed(() => {
    const collection = resourceAt(treeSelection.value?.resource, 'collection')
    return collection ? nodeTagKey(collection) : null
  })
  const activeCollectionKey = computed(() => workspaceIsCollection(activeTab.value) ? nodeTagKey(activeTab.value.target) : null)

  const isDatabaseOpen = (connectionId, database) => !!openDatabases.value[connectionId]?.[databaseKey(connectionId, database)]

  function toggleDatabase(conn, database) {
    // Selecting a database row enables database-scoped menu items.
    setTreeSelection({ resource: databaseRef(conn.id, database), connectionName: conn.name, engine: conn.engine })
    setDatabaseOpen(conn.id, databaseKey(conn.id, database), !isDatabaseOpen(conn.id, database))
  }

  // Single click only selects (highlights) the row; double click opens it. This mirrors
  // Studio-3T and lets the same collection be opened in several tabs.
  function highlightCollection(conn, db, collection) {
    setTreeSelection({ resource: collectionRef(conn.id, db.name, collection), connectionName: conn.name, engine: conn.engine })
  }

  function openCollection(conn, db, collection) {
    // Opening makes the row the active collection, so its highlight comes from
    // `activeCollectionKey`. Clear the single-click selection set by the click that
    // preceded this double-click, otherwise it lingers as a stale highlight after the
    // active tab moves to another collection.
    setTreeSelection(null)
    openCollectionTab({ resource: collectionRef(conn.id, db.name, collection), connectionName: conn.name })
  }

  return {
    selectedKey, activeCollectionKey, isDatabaseOpen, databaseKey, collectionKey,
    toggleDatabase, highlightCollection, openCollection,
  }
}
