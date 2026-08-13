<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import { useCurrentOps, FREQUENCIES, RETENTIONS } from '../../composables/useCurrentOps'
import { useConfirmDelete } from '../../composables/useConfirmDelete'

// The Current Operations tab: what the server is doing right now, refreshed on a timer.
// The list itself, the poll and the retention of finished ops live in useCurrentOps;
// this renders them.
const props = defineProps({
  activeTab: { type: Object, required: true },  // { connId, connName }
})

const {
  rows, error, errorCode, loading, updatedAt, frequency, retention, load, kill,
} = useCurrentOps(() => props.activeTab.connId)

// The selection is the opid, not the row: every poll replaces the row objects, so a
// held object would go stale the moment the table refreshed.
const selectedOpid = ref(null)
const selected = computed(() => rows.value.find(r => r.opid === selectedOpid.value) || null)
const { pendingId: pendingKill, confirmDelete: confirmKill, reset: resetKill } = useConfirmDelete()

// Two-click confirm on the toolbar button, as the drop actions elsewhere do: the first
// click arms it, the second kills. Killing an operation cannot be taken back.
async function killSelected() {
  const op = selected.value
  if (!op || op.expiredAt) return
  if (!confirmKill(op.opid)) return
  if (await kill(op.opid)) selectedOpid.value = null
}

// Keyed on the connection rather than onMounted: Vue reuses this component instance when
// the user switches between two Current Operations tabs, so mount fires only once.
watch(() => props.activeTab.connId, () => {
  rows.value = []
  selectedOpid.value = null
  resetKill()
  load()
}, { immediate: true })

// An armed kill must not survive the selection moving to a different operation.
watch(selectedOpid, resetKill)

// A tab switch unmounts the pane; drop the list so the next mount starts clean rather
// than briefly showing what a different connection was doing.
onUnmounted(() => { rows.value = [] })

const updatedText = computed(() =>
  updatedAt.value ? new Date(updatedAt.value).toLocaleTimeString() : '—'
)

function secsText(row) {
  return row.secs != null ? `${row.secs}s` : '—'
}
</script>

<template>
  <div class="cops">
    <!-- Breadcrumb -->
    <div class="crumbs">
      <BaseIcon name="connect" :size="15" class="c-ic" />
      <span class="crumb">{{ activeTab.connName }}</span>
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon name="clock" :size="15" class="c-ic" />
      <span class="crumb">Current Operations</span>
    </div>

    <!-- Toolbar -->
    <div class="cops-toolbar">
      <BaseButton variant="ghost" size="sm" icon="refresh" :icon-size="16" @click="load()">Refresh</BaseButton>
      <span class="tb-sep"></span>
      <BaseButton
        variant="ghost"
        size="sm"
        icon="trash"
        :icon-size="16"
        :class="{ armed: pendingKill != null }"
        :disabled="!selected || !!(selected && selected.expiredAt)"
        @click="killSelected"
      >{{ pendingKill != null ? 'Confirm kill' : 'Kill Operation' }}</BaseButton>
      <span class="tb-sep"></span>
      <label class="tb-opt">Update frequency:</label>
      <BaseSelect v-model="frequency" class="tb-select" size="sm" :options="FREQUENCIES" />
      <label class="tb-opt">Retain finished ops for:</label>
      <BaseSelect v-model="retention" class="tb-select" size="sm" :options="RETENTIONS" />
    </div>

    <!-- Operations -->
    <div class="cops-body">
      <StateMessage v-if="loading" mode="loading" label="Fetching current operations…" />
      <StateMessage v-else-if="error && !rows.length" mode="error" :message="error" :code="errorCode" />
      <StateMessage v-else-if="!rows.length" mode="empty" label="No operations currently in progress" />
      <table v-else class="cops-table">
        <thead>
          <tr>
            <th class="col-opid">Op ID</th>
            <th class="col-type">Type</th>
            <th class="col-ns">Namespace</th>
            <th class="col-secs">Running</th>
            <th class="col-client">Client</th>
            <th class="col-comment">Comment</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.key"
            class="cops-row"
            :class="{ expired: row.expiredAt, selected: row.opid === selectedOpid }"
            @click="selectedOpid = row.opid"
          >
            <td class="col-opid mono">{{ row.opid }}</td>
            <td class="col-type">{{ row.type || '—' }}</td>
            <td class="col-ns mono">{{ row.ns || '—' }}</td>
            <td class="col-secs">{{ secsText(row) }}</td>
            <td class="col-client">{{ row.client || row.desc || '—' }}</td>
            <td class="col-comment mono">{{ row.comment || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Status bar -->
    <div class="cops-status">
      <span>{{ rows.length }} operation{{ rows.length === 1 ? '' : 's' }}</span>
      <span class="spacer"></span>
      <span v-if="error" class="cops-err">{{ error }}</span>
      <span v-else>updated {{ updatedText }}</span>
    </div>
  </div>
</template>

<style scoped>
.cops { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }

.crumbs {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border); flex: none;
}
.sep { color: var(--text-faint); }
.c-ic { color: var(--text-faint); }

.cops-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border); flex: none;
}
.tb-sep { width: 1px; align-self: stretch; margin: 3px 6px; background: var(--border); }
.tb-opt { font-size: 12px; color: var(--text-dim); }
.tb-select { flex: none; width: 92px; }

.cops-body { flex: 1; overflow: auto; min-height: 0; }
.cops-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.cops-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 600; color: var(--text-dim);
  background: var(--bg-panel); padding: 6px 10px;
  border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-soft);
}
.cops-row td {
  padding: 5px 10px; color: var(--text); vertical-align: middle;
  border-bottom: 1px solid var(--grid-line); border-right: 1px solid var(--border-soft);
  white-space: nowrap;
}
.cops-row { cursor: pointer; }
.cops-row:hover { background: var(--bg-hover); }
.cops-row.selected { background: var(--accent); }
.cops-row.selected td { color: #fff; }
/* An op the server no longer reports, still shown for its retention window. */
.cops-row.expired td { color: var(--text-faint); font-style: italic; }
.base-btn.armed { color: var(--danger-text); }
.mono { font-family: var(--mono); }
.col-opid { width: 110px; }
.col-type { width: 96px; }
.col-secs { width: 84px; }
.col-client { width: 170px; }

.cops-status {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-toolbar); border-top: 1px solid var(--border); flex: none;
}
.cops-status .spacer { flex: 1; }
.cops-err { color: var(--danger-text); }
</style>
