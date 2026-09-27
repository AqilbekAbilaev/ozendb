<script setup>
// The connection → database → collection breadcrumb every collection-scoped MongoDB
// pane shows across its top, optionally followed by a crumb naming the pane itself
// (Indexes, Schema…). Takes plain strings rather than a tab object
// because the tab shapes disagree — collection tabs carry `connectionName` /
// `collectionName` while the tool panes carry `connName` / `collName`.
import { computed } from 'vue'
import WorkspaceCrumbs from './WorkspaceCrumbs.vue'
import { crumbSegments } from '../../utils/crumbSegments'

const props = defineProps({
  conn:  { type: String, default: '' },
  db:    { type: String, default: '' },
  coll:  { type: String, default: '' },
  // Trailing crumb; omitted (both empty) on the plain collection workspace.
  icon:  { type: String, default: '' },
  label: { type: String, default: '' },
})

const items = computed(() => crumbSegments({
  connection: props.conn,
  target: {
    segments: [
      { kind: 'database', name: props.db },
      ...(props.coll ? [{ kind: 'collection', name: props.coll }] : []),
    ],
  },
  extra: props.label ? { icon: props.icon, label: props.label } : null,
}))
</script>

<template>
  <WorkspaceCrumbs engine="mongodb" :items="items" />
</template>
