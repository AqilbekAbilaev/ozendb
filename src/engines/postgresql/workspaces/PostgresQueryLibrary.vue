<script setup>
import { ref, computed, watch } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import { listHistory, clearHistory, listSaved, saveQuery, deleteSaved } from '../api/library'
import { errMessage } from '../../../utils/errors'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// The connection's saved queries and the SQL it has run. Picking one emits `load`
// with its SQL. Given `sql`, the Saved view offers to save it under a name.
const props = defineProps({
  connectionId: { type: String, required: true },
  sql:          { type: String, default: '' },
  view:         { type: String, default: 'saved' },
})
const emit = defineEmits(['load', 'close'])

const VIEWS = [{ value: 'saved', label: 'Saved' }, { value: 'history', label: 'History' }]
const shown = ref(props.view)
const saved = ref([])
const history = ref([])
const name = ref('')
const error = ref(null)

const entries = computed(() => (shown.value === 'saved' ? saved.value : history.value))

async function attempt(action) {
  error.value = null
  try { await action() } catch (e) { error.value = errMessage(e) }
}

const reload = () => attempt(async () => {
  saved.value = await listSaved(props.connectionId)
  history.value = await listHistory(props.connectionId)
})
watch(() => props.connectionId, reload, { immediate: true })

const save = () => attempt(async () => {
  await saveQuery(props.connectionId, name.value, props.sql)
  name.value = ''
  await reload()
})
const remove = (entry) => attempt(async () => { await deleteSaved(entry.id); await reload() })
const clear = () => attempt(async () => { await clearHistory(props.connectionId); await reload() })

function load(entry) {
  emit('load', entry.sql)
  emit('close')
}

const when = (ms) => new Date(Number(ms)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <BaseModal title="Queries" width="640px" max-width="96vw" height="480px" max-height="90vh" @close="emit('close')">
    <div class="lib-bar">
      <SegmentedControl v-model="shown" :options="VIEWS" variant="subtle" />
      <FlexSpacer />
      <BaseButton v-if="shown === 'history'" bordered :disabled="!history.length" @click="clear">Clear history</BaseButton>
    </div>
    <div v-if="shown === 'saved' && sql.trim()" class="lib-save">
      <BaseInput v-model="name" class="lib-name" placeholder="Name this query…" @enter="name.trim() && save()" />
      <BaseButton variant="primary" :disabled="!name.trim()" @click="save">Save current SQL</BaseButton>
    </div>
    <div v-if="error" class="lib-error">{{ error }}</div>
    <div class="lib-list">
      <div v-for="(entry, i) in entries" :key="entry.id ?? i" class="lib-row" title="Open in the editor" @click="load(entry)">
        <div class="lib-main">
          <span v-if="entry.name" class="lib-title">{{ entry.name }}</span>
          <code>{{ entry.sql }}</code>
        </div>
        <span class="lib-when">{{ when(entry.savedAt ?? entry.ranAt) }}</span>
        <BaseButton v-if="entry.id" variant="ghost" icon="trash" title="Delete this saved query" @click.stop="remove(entry)" />
      </div>
      <div v-if="!entries.length" class="lib-empty">
        {{ shown === 'saved' ? 'No saved queries for this connection yet.' : 'Queries you run appear here.' }}
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.lib-bar, .lib-save { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex: none; }
.lib-name { flex: 1; }
.lib-error { padding: 8px 12px; color: var(--danger-text); font-size: 12.5px; }
.lib-list { flex: 1; min-height: 0; overflow-y: auto; }
.lib-row { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
.lib-row:hover { background: var(--bg-hover); }
.lib-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.lib-title { font-size: 12.5px; font-weight: 600; color: var(--text); }
.lib-main code { font: 11.5px var(--mono); color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lib-when { flex: none; font-size: 11.5px; color: var(--text-faint); }
.lib-empty { padding: 32px 16px; text-align: center; font-size: 12.5px; color: var(--text-faint); }
</style>
