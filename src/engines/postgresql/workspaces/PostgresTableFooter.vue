<script setup>
import { computed } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// The table tab's status line. `t` is the tab's usePostgresTable state.
const props = defineProps({
  t: { type: Object, required: true },
})

const range = computed(() => {
  const { offset, rows, total } = props.t
  if (!rows.length) return '0 rows'
  return `${offset + 1}–${offset + rows.length} of ${total ?? '?'} rows`
})
</script>

<template>
  <div class="pg-footer">
    <span>{{ range }}</span>
    <span v-if="t.elapsedMs != null" class="fitem"><BaseIcon name="clock" :size="14" /> {{ t.elapsedMs }} ms</span>
    <span v-if="t.activeFilters" class="fitem">
      <BaseIcon name="filter" :size="13" /> {{ t.activeFilters }} filter{{ t.activeFilters > 1 ? 's' : '' }}
    </span>
    <span v-if="t.pendingCount" class="fitem stage-pending">
      <BaseIcon name="save" :size="13" /> {{ t.pendingCount }} unsaved change{{ t.pendingCount > 1 ? 's' : '' }}
    </span>
    <span>Auto-commit</span>
    <FlexSpacer />
    <span class="paging">
      <BaseButton icon="prev" size="sm" :disabled="!t.hasPrev || t.loading" title="Previous page" @click="t.prevPage" />
      <BaseButton icon="next" size="sm" :disabled="!t.hasNext || t.loading" title="Next page" @click="t.nextPage" />
    </span>
    <template v-if="t.server">
      <span>{{ t.server.encoding }}</span>
      <span>PostgreSQL {{ t.server.version }}</span>
    </template>
  </div>
</template>

<style scoped>
.pg-footer {
  display: flex; align-items: center; gap: 16px; flex: none;
  padding: 4px 12px; font-size: 12px; color: var(--text-dim);
  border-top: 1px solid var(--border); background: var(--bg-panel);
}
.fitem { display: flex; align-items: center; gap: 6px; }
.stage-pending { color: var(--warn); }
.paging { display: flex; gap: 2px; }
</style>
