import { ref } from 'vue'
import { listConnections } from '../appApi/connections'
import { getNodeTags } from '../appApi/tags'

// Colour tags by tree node key; drives the coloured dot in the sidebar and on tabs.
// Connection tags persist on the connection config (conn.tag) and database/collection
// tags in the node-tag store, so the two are read from different places and merged.
export const tagOverrides = ref({})

// Shows a colour that has just been persisted. Every colour write goes through here, so
// the sidebar and the tab bar pick it up the moment it is saved. `clearPrefix` drops the
// tags of the node's descendants, for a write that reset them.
export function setTagOverride(key, color, clearPrefix = null) {
  const updated = { ...tagOverrides.value, [key]: color }
  if (clearPrefix) {
    for (const existing of Object.keys(updated)) {
      if (existing.startsWith(clearPrefix)) delete updated[existing]
    }
  }
  tagOverrides.value = updated
}

export async function loadNodeTags() {
  try {
    const nodeTags = await getNodeTags()
    if (nodeTags) tagOverrides.value = { ...nodeTags, ...tagOverrides.value }
  } catch (_) {}
  try {
    const connTags = {}
    for (const c of await listConnections()) {
      if (c.tag) connTags[c.id] = c.tag
    }
    if (Object.keys(connTags).length) {
      tagOverrides.value = { ...tagOverrides.value, ...connTags }
    }
  } catch (_) {}
}
