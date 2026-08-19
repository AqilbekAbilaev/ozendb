<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { listSavedQueries, deleteSavedQuery } from '../../engines/mongodb/api/queryLibrary'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'

const emit = defineEmits(['close', 'apply'])

const entries  = ref([])
const search   = ref('')
const selected = ref(null)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(e => e.name.toLowerCase().includes(q))
})

onMounted(async () => {
  try {
    entries.value = await listSavedQueries()
  } catch (_) {
    entries.value = []
  }
})

function select(entry) {
  selected.value = entry
}

function load() {
  if (!selected.value) return
  emit('apply', selected.value)
  emit('close')
}

async function remove() {
  if (!selected.value) return
  try {
    await deleteSavedQuery(selected.value.id)
    entries.value = entries.value.filter(e => e.id !== selected.value.id)
    selected.value = null
  } catch (_) {}
}

function fmt(ranAt) {
  const ms = Number(ranAt)
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

function handleKey(e) {
  if (e.key === 'Enter' && selected.value) load()
}

// Enter loads the selected query. Escape-to-close is handled by BaseModal.
onMounted(() => window.addEventListener('keydown', handleKey))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKey))
</script>

<template>
  <BaseModal title="Saved Queries" width="700px" max-width="96vw" height="540px" max-height="92vh" @close="emit('close')">
      <!-- Search -->
      <div class="qb-search">
        <BaseIcon name="search" :size="14" class="search-ic" />
        <BaseInput
          v-model="search"
          class="search-input"
          placeholder="Search queries…"
        />
      </div>

      <!-- List -->
      <div class="qb-list">
        <table class="qbt">
          <thead>
            <tr>
              <th class="col-name">Query name</th>
              <th class="col-mode">Mode</th>
              <th class="col-date">Saved</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in filtered"
              :key="entry.id"
              :class="{ sel: selected && selected.id === entry.id }"
              @click="select(entry)"
              @dblclick="load"
            >
              <td class="col-name">{{ entry.name }}</td>
              <td class="col-mode">{{ entry.mode }}</td>
              <td class="col-date">{{ fmt(entry.saved_at) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="filtered.length === 0" class="qb-empty">
          {{ entries.length === 0 ? 'No saved queries yet.' : 'No results for your search.' }}
        </div>
      </div>

      <!-- Preview -->
      <div class="qb-preview">
        <div v-if="selected" class="preview-body">
          <template v-if="selected.mode === 'aggregate'">
            <div class="prow"><span class="pl">Pipeline</span><code class="pv">{{ selected.pipeline || '[]' }}</code></div>
          </template>
          <template v-else>
            <div class="prow"><span class="pl">Filter</span><code class="pv">{{ selected.filter || '{}' }}</code></div>
            <div class="prow"><span class="pl">Sort</span><code class="pv">{{ selected.sort || '{}' }}</code></div>
            <div v-if="selected.projection && selected.projection !== '{}'">
              <div class="prow"><span class="pl">Projection</span><code class="pv">{{ selected.projection }}</code></div>
            </div>
            <div class="prow-nums">
              <span class="pl">Skip</span><span class="pv-n">{{ selected.skip }}</span>
              <span class="pl">Limit</span><span class="pv-n">{{ selected.limit }}</span>
            </div>
          </template>
        </div>
        <div v-else class="preview-hint">
          Select a query above to preview it.
        </div>
      </div>

      <!-- Footer -->
      <div class="qb-footer">
        <BaseButton bordered :disabled="!selected" @click="remove">
          <BaseIcon name="trash" :size="13" class="ic" /> Delete
        </BaseButton>
        <span class="spacer" />
        <BaseButton bordered @click="emit('close')">Close</BaseButton>
        <BaseButton variant="primary" :disabled="!selected" @click="load">Load</BaseButton>
      </div>
  </BaseModal>
</template>

<style scoped>
/* Search */
.qb-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.search-ic { color: var(--text-faint); flex: none; }
.base-input.search-input {
  flex: 1;
  background: transparent;
  border: none;
  padding: 0;
  font-size: 13px;
}

/* List */
.qb-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.qbt {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.qbt th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-panel-2);
  color: var(--text);
  font-weight: 600;
  padding: 7px 12px;
  text-align: left;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.qbt td {
  padding: 8px 12px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}
.col-name { width: 55%; }
.col-mode { width: 15%; }
.col-date { width: 30%; }
.qbt tr { cursor: pointer; }
.qbt tr:hover td { background: var(--bg-hover); }
.qbt tr.sel td { background: var(--accent); color: #fff; }

.qb-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-faint);
}

/* Preview */
.qb-preview {
  height: 130px;
  flex: none;
  border-top: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px 12px;
  background: var(--bg-panel);
}
.preview-body { display: flex; flex-direction: column; gap: 4px; }
.prow { display: flex; gap: 8px; align-items: baseline; }
.prow-nums { display: flex; gap: 12px; align-items: baseline; margin-top: 2px; }
.pl {
  font-size: 10.5px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .4px;
  min-width: 60px;
  flex: none;
}
.pv {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pv-n {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-dim);
}
.preview-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-faint);
  font-size: 12.5px;
  height: 100%;
  justify-content: center;
}

/* Footer */
.qb-footer {
  height: 52px;
  flex: none;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
}
.spacer { flex: 1; }
.ic { color: inherit; }
</style>
