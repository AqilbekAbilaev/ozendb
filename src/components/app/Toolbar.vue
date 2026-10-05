<script setup>
// The global toolbar strip. Presentational only: renders the TOOLS buttons for the
// engine in focus and emits `tool` with the clicked action id; App.vue routes that into
// its handleTool dispatcher. `hidden` is driven by the View → Hide Global Toolbar toggle.
import { computed } from 'vue'
import ToolbarButton from '../base/ToolbarButton.vue'
import { TOOLS } from '../../constants/tools'
import { toolbarTools } from '../../utils/toolbarTools'

const props = defineProps({
  hidden: { type: Boolean, default: false },
  // The native menu's engine ('mongodb' | 'postgresql' | 'none'), so the two agree.
  engine: { type: String, default: 'none' },
})
const tools = computed(() => toolbarTools(TOOLS, props.engine))
defineEmits(['tool'])
</script>

<template>
  <div class="toolbar" v-show="!hidden">
    <template v-for="(t, i) in tools" :key="i">
      <div v-if="t.sep" class="tb-sep"></div>
      <ToolbarButton v-else :icon="t.icon || t.name" :label="t.label" :badge="t.badge" :drop="t.drop" :title="t.label" @click="$emit('tool', t.name)" />
    </template>
  </div>
</template>

<style scoped>
.toolbar {
  flex: none;
  background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: stretch;
  padding: 6px 8px;
  gap: 2px;
}
.tb-sep { width: 1px; flex: none; background: var(--border-soft); margin: 6px 4px; align-self: stretch; }
</style>
