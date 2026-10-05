<script setup>
import { ref, computed } from 'vue'
import { searchTables } from '../api/resources'
import { cancelQuery } from '../api/queries'
import { openPostgresTable } from '../../../stores/tabCreators'
import { errText, errCode } from '../../../utils/errors'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import HintText from '../../../components/base/HintText.vue'

// Cross-table "Search in…" (ozendb-86k): a substring or regex match across every
// text-like column of a schema's tables (or an explicit subset), the Postgres
// sibling of MongoDB's SearchPane — scoped to one schema rather than a whole
// database, since a Postgres connection is already bound to one database and
// "every table in the database" is the expensive, unbounded case the ticket
// itself flagged as needing an explicit scope selector.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, database, schema }
})
defineEmits(['close'])

const term = ref('')
const tablesText = ref('')  // comma-separated; blank means every table in the schema
const matchCase = ref(false)
const regex = ref(false)

const result = ref(null)
const loading = ref(false)
const error = ref(null)
const errorCode = ref(null)
const runId = ref(null)

const tableList = computed(() => {
  const names = tablesText.value.split(',').map((s) => s.trim()).filter(Boolean)
  return names.length ? names : null
})

async function search() {
  const t = term.value.trim()
  if (!t || loading.value) return
  loading.value = true
  error.value = null
  errorCode.value = null
  result.value = null
  runId.value = crypto.randomUUID()
  try {
    result.value = await searchTables(
      { connectionId: props.target.connId, schema: props.target.schema, tables: tableList.value },
      t,
      { matchCase: matchCase.value, regex: regex.value, runId: runId.value },
    )
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
    runId.value = null
  }
}

function cancel() {
  if (runId.value) cancelQuery(props.target.connId, runId.value).catch(() => {})
}

// A match opens its row in a new table tab, filtered by its primary key (#172). The
// dialog stays open, so several matches can be looked at in turn.
function openMatch(m) {
  const { connId, connName, database, schema } = props.target
  openPostgresTable({ connectionId: connId, connectionName: connName, database, schema, table: m.table, rowKey: m.primaryKey })
}

function keyText(pk) {
  return Object.entries(pk).map(([k, v]) => `${k} = ${v}`).join(', ')
}
</script>

<template>
  <BaseModal :title="`Search in Schema — ${target.schema}`" width="min(1000px, calc(100vw - 40px))" max-height="calc(100vh - 80px)" @close="$emit('close')">
    <!-- Not scrollable as a whole: the controls and the match count stay put while
         only the list scrolls (#171). -->
    <BaseModalBody :scrollable="false" class="ps-body">
      <div class="ps-controls">
        <BaseInput v-model="term" placeholder="Search for…" class="ps-term" @keydown.enter="search" />
        <BaseButton v-if="!loading" bordered :disabled="!term.trim()" @click="search">Search</BaseButton>
        <BaseButton v-else bordered @click="cancel">Cancel</BaseButton>
      </div>
      <div class="ps-controls">
        <BaseInput v-model="tablesText" placeholder="Tables (comma-separated; blank = every table in this schema)" class="ps-tables" />
        <BaseCheckbox v-model="matchCase" label="Match case" />
        <BaseCheckbox v-model="regex" label="Regex" />
      </div>

      <StateMessage v-if="loading" mode="loading" label="Searching…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <StateMessage v-else-if="result && !result.matches.length" mode="empty" label="No matches" />
      <template v-else-if="result">
        <HintText dim>
          {{ result.matches.length }} match{{ result.matches.length === 1 ? '' : 'es' }}
          <span v-if="result.truncated">(more exist; narrow the search or the table list)</span>
          <span v-if="result.skipped.length">· skipped (no primary key or no text column): {{ result.skipped.join(', ') }}</span>
        </HintText>
        <div class="ps-list">
          <div
            v-for="(m, i) in result.matches" :key="i" class="ps-item" role="button" tabindex="0"
            title="Open this row in a table tab" @click="openMatch(m)" @keydown.enter="openMatch(m)"
          >
            <code class="ps-loc">{{ m.table }}.{{ m.column }}</code>
            <span class="ps-value" :title="m.value">{{ m.value }}</span>
            <span class="ps-key">{{ keyText(m.primaryKey) }}</span>
          </div>
        </div>
      </template>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.ps-body { min-height: 0; }
.ps-controls { flex: none; display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.ps-term, .ps-tables { flex: 1; }
.ps-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.ps-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
  background: var(--bg-field); cursor: pointer;
}
.ps-item:hover, .ps-item:focus-visible { background: var(--bg-hover); outline: none; }
.ps-loc { flex: none; font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
.ps-value { flex: 1; min-width: 0; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-key { flex: none; font-size: 11px; color: var(--text-faint); }
</style>
