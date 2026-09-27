<script setup>
import { computed } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import EngineBadge from '../../../components/base/EngineBadge.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import { openConnections } from '../../../stores/openConnections'

// The table tab's top line: engine, login and server, the table's path, and the
// Filter / SQL switch.
const props = defineProps({
  activeTab: { type: Object, required: true },
  mode:      { type: String, required: true },
})
const emit = defineEmits(['mode'])

const MODES = [{ value: 'filter', label: 'Filter', icon: 'filter' }, { value: 'sql', label: 'SQL', icon: 'sql' }]

const conn = computed(() => openConnections.value.find(c => c.id === props.activeTab.connectionId))
const server = computed(() => {
  const host = conn.value?.hosts?.[0]
  return host ? `${host.host}:${host.port}` : null
})
</script>

<template>
  <div class="pg-crumbs">
    <EngineBadge engine="postgresql" />
    <template v-if="conn?.username">
      <span>{{ conn.username }}</span>
      <BaseIcon name="caret" :size="11" class="c-ic" />
    </template>
    <span>{{ activeTab.connectionName }}<template v-if="server"> ({{ server }})</template></span>
    <BaseIcon name="caret" :size="11" class="c-ic" />
    <BaseIcon name="dbSmall" :size="15" class="c-ic" />
    <span>{{ activeTab.database }}</span>
    <BaseIcon name="caret" :size="11" class="c-ic" />
    <BaseIcon name="folder" :size="15" class="c-ic" />
    <span>{{ activeTab.schema }}</span>
    <BaseIcon name="caret" :size="11" class="c-ic" />
    <BaseIcon name="table" :size="15" class="c-ic" />
    <span class="pg-name">{{ activeTab.table }}</span>
    <span class="spacer"></span>
    <SegmentedControl :model-value="mode" :options="MODES" variant="subtle" @update:model-value="emit('mode', $event)" />
  </div>
</template>

<style scoped>
.pg-crumbs {
  display: flex; align-items: center; gap: 7px; flex: none; min-height: 34px;
  padding: 4px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.c-ic { color: var(--text-faint); }
.pg-name { color: var(--text); }
.spacer { flex: 1; }
</style>
