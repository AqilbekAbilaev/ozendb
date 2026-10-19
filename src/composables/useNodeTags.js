import { setConnectionTag, setNodeTag, clearNodeTagsUnder } from '../appApi/tags'
import { setTagOverride } from '../stores/nodeTags'
import { nodeTagKey } from '../utils/tabColor'

// Writes a colour tag and mirrors it into the store's tagOverrides once persisted.
export function useNodeTags() {
  let tagWrite = Promise.resolve()

  // Apply a colour to a node. `type` is 'connection' | 'pg:database' | 'pg:schema' | 'pg:table'
  // | 'collection'; `nodeData` is the sidebar's right-click node, which carries the row's
  // `resource`. Colouring a parent resets its descendants (drop their own tags so they
  // inherit the parent's new colour).
  function applyColorTag(request) {
    const write = tagWrite.then(() => persistColorTag(request))
    tagWrite = write.catch(() => {})
    return write
  }

  async function persistColorTag({ type, nodeData, color }) {
    const resource = nodeData.resource
    let clearPrefix = null
    let key
    if (type === 'connection') {
      key = resource.connectionId
      await setConnectionTag(resource.connectionId, color)
      clearPrefix = key + '/'
    } else if (type.startsWith('pg:')) {
      // PostgreSQL database/schema/table tags use JSON-encoded keys so schema/names with '/'
      // don't collide (e.g. schema "a/b" vs table "b" in schema "a").
      // The resource has segments: [{kind:'database', name:'...'}, {kind:'schema', name:'...'}, {kind:'table', name:'...'}]
      const schemaSeg = resource.segments.find((s) => s.kind === 'schema')
      const tableSeg = resource.segments.find((s) => s.kind === 'table')
      const schemaName = schemaSeg ? schemaSeg.name : null
      const tableName = tableSeg ? tableSeg.name : null
      // key format: JSON.stringify(['pg', connId, level, schema, tableOrNull])
      // level is 'database'|'schema'|'table' extracted from type.slice(3)
      const level = type.slice(3) // 'database', 'schema', or 'table'
      key = JSON.stringify(['pg', resource.connectionId, level, schemaName, level === 'table' ? tableName : null])
      await setNodeTag(key, color)
      // Clear children only when colouring a database (type = pg:database)
      if (type === 'pg:database') {
        clearPrefix = key + '/'
      }
    } else {
      // Database/collection tags go in the dedicated node-tag store, keyed by the node's tree
      // path so a colour tags only that node, not the whole connection.
      key = nodeTagKey(resource)
      await setNodeTag(key, color)
      if (type === 'database') clearPrefix = key + '/'
    }
    if (clearPrefix) {
      try {
        await clearNodeTagsUnder(clearPrefix)
      } catch (e) {
        setTagOverride(key, color)
        throw e
      }
    }

    setTagOverride(key, color, clearPrefix)
  }

  return { applyColorTag: applyColorTag }
}
