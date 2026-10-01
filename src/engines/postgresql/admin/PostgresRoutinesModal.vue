<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { routines as listRoutines, routineSource } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { signature, groupBySchema, matchRoutines } from './routineRows'
import { openPostgresQuery } from '../../../stores/tabCreators'
import { showToast } from '../../../stores/toast'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Opened from a PostgreSQL database or schema node. Read-only: the source shown is
// the server's own CREATE statement, and editing it means opening a SQL tab, where
// CREATE OR REPLACE already works — no DDL builder of our own.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, database, schema? }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])
const search = ref('')
const selected = ref(null)
const source = ref('')
const sourceError = ref(null)
const loadingSource = ref(false)

onMounted(async () => {
  try {
    all.value = await listRoutines(props.target.connId, props.target.schema ?? null)
    selected.value = all.value[0] ?? null
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})

const shown = computed(() => matchRoutines(all.value, search.value))
const groups = computed(() => groupBySchema(shown.value))

// The source is read per routine rather than with the listing: a schema can hold
// hundreds, and all anyone reads is the one they clicked.
watch(selected, async (routine) => {
  source.value = ''
  sourceError.value = null
  if (!routine) return
  loadingSource.value = true
  const mine = routine.oid
  try {
    const text = await routineSource(props.target.connId, routine.oid)
    if (selected.value?.oid === mine) source.value = text
  } catch (e) {
    if (selected.value?.oid === mine) sourceError.value = errText(e)
  } finally {
    if (selected.value?.oid === mine) loadingSource.value = false
  }
}, { immediate: true })

function copySource() {
  navigator.clipboard.writeText(source.value)
    .then(() => showToast('Definition copied'))
    .catch(() => showToast('Copy to clipboard failed'))
}

function editInSqlTab() {
  openPostgresQuery({
    connectionId: props.target.connId,
    connectionName: props.target.connName,
    database: props.target.database,
    sql: source.value,
  })
}
</script>

<template>
  <BaseModal
    :title="`Functions & Procedures — ${target.schema ?? target.database}`"
    width="900px"
    max-width="95vw"
    @close="$emit('close')"
  >
    <BaseModalBody>
      <StateMessage v-if="loading" mode="loading" label="Reading functions and procedures…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <StateMessage
        v-else-if="!all.length"
        mode="empty"
        label="No functions or procedures here. Aggregates and window functions aren't listed yet."
      />
      <div v-else class="pr-split">
        <div class="pr-list">
          <BaseInput v-model="search" placeholder="Search by name, schema or argument…" class="pr-search" />
          <div v-if="!shown.length" class="pr-empty">Nothing matches “{{ search }}”.</div>
          <template v-for="group in groups" :key="group.schema">
            <div class="pr-schema">{{ group.schema }}</div>
            <div
              v-for="routine in group.routines"
              :key="routine.oid"
              class="pr-item"
              :class="{ on: selected?.oid === routine.oid }"
              @click="selected = routine"
            >
              <BaseIcon :name="routine.kind === 'procedure' ? 'run' : 'aggregate'" :size="13" class="pr-ic" />
              <span class="pr-sig">{{ signature(routine) }}</span>
              <span class="pr-lang">{{ routine.language }}</span>
            </div>
          </template>
        </div>

        <div class="pr-source">
          <div class="pr-bar">
            <span class="pr-kind">{{ selected?.kind ?? '' }}</span>
            <FlexSpacer />
            <BaseButton variant="ghost" icon="copy" :disabled="!source" @click="copySource">Copy definition</BaseButton>
            <BaseButton variant="primary" icon="sql" :disabled="!source" @click="editInSqlTab">Open in SQL tab</BaseButton>
          </div>
          <StateMessage v-if="loadingSource" mode="loading" />
          <StateMessage v-else-if="sourceError" mode="error" :message="sourceError" />
          <CodeEditor v-else :model-value="source" readonly language="sql" class="pr-code" />
        </div>
      </div>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.pr-split { display: flex; gap: 12px; height: 60vh; min-height: 0; margin-top: 12px; }
.pr-list {
  flex: none; width: 330px; display: flex; flex-direction: column; min-height: 0;
  overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; padding: 8px;
}
.pr-search { width: 100%; margin-bottom: 8px; }
.pr-empty { padding: 12px 4px; color: var(--text-faint); font-size: 12.5px; }
.pr-schema {
  padding: 6px 4px 3px; font-size: 11px; color: var(--text-faint);
  text-transform: uppercase; letter-spacing: .04em;
}
.pr-item {
  display: flex; align-items: baseline; gap: 6px; padding: 5px 6px;
  border-radius: 5px; cursor: pointer; font-size: 12.5px;
}
.pr-item:hover { background: var(--bg-hover); }
.pr-item.on { background: var(--bg-active); }
.pr-ic { color: var(--text-faint); flex: none; align-self: center; }
.pr-sig { flex: 1; font-family: var(--mono); font-size: 11.5px; word-break: break-word; }
.pr-lang { flex: none; color: var(--text-faint); font-size: 10.5px; }
.pr-source { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.pr-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.pr-kind { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.pr-code { flex: 1; min-height: 0; border: 1px solid var(--border); border-radius: 6px; }
</style>
