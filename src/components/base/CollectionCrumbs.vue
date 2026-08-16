<script setup>
// The connection → database → collection breadcrumb every collection-scoped pane
// shows across its top, optionally followed by a crumb naming the pane itself
// (Indexes, Schema…). Takes plain strings rather than a tab object
// because the tab shapes disagree — collection tabs carry `connectionName` /
// `collectionName` while the tool panes carry `connName` / `collName`.
import BaseIcon from './BaseIcon.vue'

defineProps({
  conn:  { type: String, default: '' },
  db:    { type: String, default: '' },
  coll:  { type: String, default: '' },
  // Trailing crumb; omitted (both empty) on the plain collection workspace.
  icon:  { type: String, default: '' },
  label: { type: String, default: '' },
})
</script>

<template>
  <div class="crumbs">
    <BaseIcon name="connect" :size="15" class="c-ic" />
    <span class="crumb">{{ conn }}</span>
    <BaseIcon name="caret" :size="11" class="sep" />
    <BaseIcon name="dbSmall" :size="15" class="c-ic" />
    <span class="crumb">{{ db }}</span>
    <template v-if="coll">
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon name="collSmall" :size="15" class="c-ic" />
      <span class="crumb">{{ coll }}</span>
    </template>
    <template v-if="label">
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon :name="icon" :size="15" class="c-ic" />
      <span class="crumb">{{ label }}</span>
    </template>
  </div>
</template>

<style scoped>
.crumbs {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border); flex: none;
}
.sep { color: var(--text-faint); }
.c-ic { color: var(--text-faint); }
</style>
