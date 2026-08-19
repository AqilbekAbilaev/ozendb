// Node colour tags for the sidebar tree (connections, databases, collections).

import { invoke } from '@tauri-apps/api/core'

export function getNodeTags() {
  return invoke('get_node_tags')
}

export function setConnectionTag(connectionId, color) {
  return invoke('set_connection_tag', { id: connectionId, color })
}

export function setNodeTag(key, color) {
  return invoke('set_node_tag', { key, color })
}

export function clearNodeTagsUnder(prefix) {
  return invoke('clear_node_tags_under', { prefix })
}