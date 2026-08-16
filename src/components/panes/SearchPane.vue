<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import StateMessage from '../base/StateMessage.vue'

// The Search tab scans a database for a value or field name, the way Studio-3T's
// "Search in…" does — one grid row per matching field (its collection, document _id,
// dotted path, and value, with the term highlighted). The database and collection are
// pickable in the header; "All collections" scans every collection in the database.
const props = defineProps({
  activeTab: { type: Object, required: true },  // { connId, connName, dbName }
})

const ALL = ''  // collection sentinel: scan every collection in the database

const scopeOptions = [
  { value: 'both', label: 'Field value and name' },
  { value: 'value', label: 'Field value' },
  { value: 'name', label: 'Field name' },
]

// Databases (with their collections) for this connection, loaded once for the pickers.
const databases = ref([])
const selectedDb = ref(props.activeTab.dbName)
const selectedColl = ref(ALL)
const initErr = ref(null)

const dbOptions = computed(() => databases.value.map((d) => ({ value: d.name, label: d.name })))
const collections = computed(() => {
  const db = databases.value.find((d) => d.name === selectedDb.value)
  return (db && db.collections) ? db.collections : []
})
const collOptions = computed(() => [
  { value: ALL, label: 'All collections' },
  ...collections.value.map((c) => ({ value: c, label: c })),
])

async function loadDatabases() {
  initErr.value = null
  try {
    databases.value = await invoke('list_databases', { id: props.activeTab.connId })
  } catch (e) {
    initErr.value = errText(e)
  }
}
onMounted(loadDatabases)

// Switching database invalidates the chosen collection — fall back to "All collections".
watch(selectedDb, () => { selectedColl.value = ALL })

const term = ref('')
const scope = ref('both')
const matchCase = ref(false)
const regex = ref(false)

const result = ref(null)         // { hits, scanned, truncated }
const loading = ref(false)
const error = ref(null)
const errorCode = ref(null)
// The query that produced `result`, snapshotted so highlighting stays correct even if the
// controls change before the next search.
const applied = ref(null)        // { term, matchCase, regex }

async function search() {
  const t = term.value.trim()
  if (!t) return
  loading.value = true
  error.value = null
  errorCode.value = null
  result.value = null
  try {
    const res = await invoke('search_collections', {
      id: props.activeTab.connId,
      database: selectedDb.value,
      collection: selectedColl.value || null,
      term: t,
      scope: scope.value,
      matchCase: matchCase.value,
      regex: regex.value,
    })
    result.value = res
    applied.value = { term: t, matchCase: matchCase.value, regex: regex.value }
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}

const matchLabel = computed(() => {
  if (!result.value) return ''
  const n = result.value.hits.length
  const base = n === 1 ? '1 match' : `${n} matches`
  return result.value.truncated ? `${base} (first ${n} shown)` : base
})

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Split a cell's text into plain/highlighted segments around the applied search term, so
// the match can be wrapped in <mark> without resorting to v-html.
function segments(text) {
  const value = text == null ? '' : String(text)
  const q = applied.value
  if (!q || !q.term) return [{ text: value, hit: false }]
  let re
  try {
    const flags = q.matchCase ? 'g' : 'gi'
    re = new RegExp(q.regex ? q.term : escapeRegExp(q.term), flags)
  } catch {
    return [{ text: value, hit: false }]
  }
  const out = []
  let last = 0
  let m
  while ((m = re.exec(value)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue }
    if (m.index > last) out.push({ text: value.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ text: value.slice(last), hit: false })
  return out.length ? out : [{ text: value, hit: false }]
}
</script>

<template>
  <div class="search-pane">
    <!-- Breadcrumb with database + collection pickers -->
    <div class="crumbs">
      <BaseIcon name="connect" :size="15" class="c-ic" />
      <span class="crumb">{{ activeTab.connName }}</span>
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon name="dbSmall" :size="15" class="c-ic" />
      <BaseSelect v-model="selectedDb" class="cr-select" size="sm" :options="dbOptions" />
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon name="collection" :size="15" class="c-ic" />
      <BaseSelect v-model="selectedColl" class="cr-select" size="sm" :options="collOptions" />
    </div>

    <!-- Toolbar -->
    <div class="se-toolbar">
      <BaseSelect v-model="scope" class="se-scope" size="sm" :options="scopeOptions" />
      <BaseInput
        v-model="term"
        class="se-input"
        placeholder="Search…"
        @enter="search"
      />
      <label class="se-opt"><BaseCheckbox v-model="matchCase" /> Match case</label>
      <label class="se-opt"><BaseCheckbox v-model="regex" /> RegEx</label>
      <BaseButton variant="primary" :disabled="loading || !term.trim()" @click="search">
        {{ loading ? 'Searching…' : 'Search' }}
      </BaseButton>
    </div>

    <!-- Results -->
    <div class="se-body">
      <StateMessage v-if="initErr" mode="error" :message="initErr" />
      <StateMessage v-else-if="loading" mode="loading" label="Scanning collections…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <StateMessage
        v-else-if="result && !result.hits.length"
        mode="empty"
        label="No matches found"
      />
      <div v-else-if="result" class="se-grid-wrap">
        <table class="se-grid">
          <thead>
            <tr>
              <th class="col-db">Database</th>
              <th class="col-coll">Collection</th>
              <th class="col-id">_id</th>
              <th class="col-path">Path</th>
              <th class="col-value">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in result.hits" :key="i">
              <td class="col-db">{{ h.database }}</td>
              <td class="col-coll">{{ h.collection }}</td>
              <td class="col-id mono" :title="h.id">{{ h.id }}</td>
              <td class="col-path mono">
                <template v-for="(s, j) in segments(h.path)" :key="j"><mark v-if="s.hit">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>
              </td>
              <td class="col-value mono">
                <template v-for="(s, j) in segments(h.value)" :key="j"><mark v-if="s.hit">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <StateMessage v-else mode="empty" label="Enter a term and press Search" />
    </div>

    <!-- Status bar -->
    <div v-if="result && result.hits.length" class="se-status">
      <span>{{ matchLabel }}</span>
      <span class="se-scanned">scanned {{ result.scanned }} document{{ result.scanned === 1 ? '' : 's' }}</span>
    </div>
  </div>
</template>

<style scoped>
.search-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }

.crumbs {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border); flex: none;
}
.sep { color: var(--text-faint); }
.c-ic { color: var(--text-faint); }
.cr-select { flex: none; width: 180px; }

.se-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; flex: none;
  border-bottom: 1px solid var(--border);
}
.se-scope { flex: none; width: 190px; }
.base-input.se-input { flex: 1; }
.se-opt {
  display: flex; align-items: center; gap: 5px;
  font-size: 12.5px; color: var(--text-dim); cursor: pointer; white-space: nowrap;
}

.se-body { flex: 1; min-height: 0; overflow: auto; }

.se-grid-wrap { min-width: 0; }
.se-grid { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.se-grid thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 600; color: var(--text-dim);
  background: var(--bg-panel-2);
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.se-grid tbody td {
  padding: 5px 12px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text-dim);
  vertical-align: top;
}
.se-grid tbody tr:hover td { background: var(--bg-hover); }
.mono { font-family: var(--mono); }
.col-id { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-path { white-space: nowrap; color: var(--text); }
.col-value { word-break: break-word; color: var(--text); }
.se-grid mark {
  background: color-mix(in srgb, var(--warn) 40%, transparent);
  color: var(--text);
  border-radius: 2px;
  padding: 0 1px;
}

.se-status {
  flex: none;
  display: flex; align-items: center; gap: 16px;
  padding: 5px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-faint);
}
.se-scanned { margin-left: auto; }
</style>
