<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { errText, errCode } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import HintText from '../base/HintText.vue'
import { FIELD_STRATEGIES, EXPORT_FORMATS } from '../../constants/dataTools'
import CollectionCrumbs from '../base/CollectionCrumbs.vue'

// The Data Masking tab lists the collection's fields (from a sample document) and lets the
// user pick a masking strategy per field, then exports an obfuscated copy — the source
// collection is never touched. Each tab reads its own collection and re-reads on retarget.
const props = defineProps({
  activeTab: { type: Object, required: true },  // { connId, connName, dbName, collName }
})
const { showToast } = useToast()


const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const fields = ref([])          // [{ name, strategy, keepStart, keepEnd }]
const format = ref('json')
const limit = ref('')
const exporting = ref(false)

async function loadFields() {
  loading.value = true
  error.value = null
  errorCode.value = null
  fields.value = []
  try {
    const sample = await invoke('find_documents', {
      id: props.activeTab.connId,
      database: props.activeTab.dbName,
      collection: props.activeTab.collName,
      filter: '{}',
      projection: '{}',
      sort: '{}',
      skip: 0,
      limit: 1,
    })
    if (sample && sample.length) {
      fields.value = Object.keys(sample[0]).map(name => ({
        name,
        strategy: 'keep',
        keepStart: 0,
        keepEnd: 4,
      }))
    }
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}

onMounted(loadFields)
watch(() => props.activeTab.connId + ':' + props.activeTab.dbName + ':' + props.activeTab.collName, loadFields)

const maskedCount = computed(() => fields.value.filter(f => f.strategy !== 'keep').length)

async function runExport() {
  error.value = null
  const rules = fields.value
    .filter(f => f.strategy !== 'keep')
    .map(f => {
      const rule = { field: f.name, strategy: f.strategy }
      if (f.strategy === 'partial') {
        rule.keepStart = Number(f.keepStart) || 0
        rule.keepEnd = Number(f.keepEnd) || 0
      }
      return rule
    })

  let path
  try {
    path = await saveDialog({
      defaultPath: `${props.activeTab.collName}-masked.${format.value}`,
      filters: [{ name: format.value.toUpperCase(), extensions: [format.value] }],
    })
  } catch (_) {
    return
  }
  if (!path) return

  exporting.value = true
  try {
    const trimmed = String(limit.value).trim()
    const lim = trimmed ? Number(trimmed) : null
    const count = await invoke('export_masked_collection', {
      id: props.activeTab.connId,
      database: props.activeTab.dbName,
      collection: props.activeTab.collName,
      filter: '{}',
      rules,
      path,
      format: format.value,
      limit: lim,
    })
    showToast(`Exported ${count} masked document${count === 1 ? '' : 's'}`)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="mask-pane">
    <!-- Breadcrumb -->
    <CollectionCrumbs :conn="activeTab.connName" :db="activeTab.dbName" :coll="activeTab.collName" icon="mask" label="Data Masking" />

    <div class="mk-body">
      <StateMessage v-if="loading" mode="loading" label="Reading fields…" />
      <StateMessage
        v-else-if="error && !fields.length"
        mode="error"
        :message="error"
        :code="errorCode"
      />
      <StateMessage
        v-else-if="!fields.length"
        mode="empty"
        label="No documents to sample fields from"
      />
      <template v-else>
        <HintText dim>
          Choose how each field is obfuscated in the exported copy. The source
          collection is never modified.
        </HintText>

        <div class="mk-head">
          <span>Field</span>
          <span>Strategy</span>
          <span>Options</span>
        </div>
        <div class="mk-rows">
          <div v-for="f in fields" :key="f.name" class="mk-row">
            <code class="mk-field" :title="f.name">{{ f.name }}</code>
            <BaseSelect v-model="f.strategy" class="mk-select" :options="FIELD_STRATEGIES" size="sm" />
            <span class="mk-opts">
              <template v-if="f.strategy === 'partial'">
                keep
                <BaseInput v-model="f.keepStart" type="number" min="0" class="mk-num" /> start
                <BaseInput v-model="f.keepEnd" type="number" min="0" class="mk-num" /> end
              </template>
            </span>
          </div>
        </div>

        <StateMessage v-if="error && fields.length" mode="error" :message="error" :code="errorCode" />
      </template>
    </div>

    <!-- Footer -->
    <div v-if="fields.length" class="mk-foot">
      <label class="mk-f">
        Format
        <BaseSelect v-model="format" class="mk-select" :options="EXPORT_FORMATS" size="sm" />
      </label>
      <label class="mk-f">
        Limit
        <BaseInput v-model="limit" type="number" min="1" placeholder="all" class="mk-num wide" />
      </label>
      <span class="mk-summary">{{ maskedCount }} field{{ maskedCount === 1 ? '' : 's' }} masked</span>
      <BaseButton variant="primary" :disabled="exporting" @click="runExport">
        {{ exporting ? 'Exporting…' : 'Export masked copy' }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.mask-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }


.mk-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; }
.mk-head {
  display: grid;
  grid-template-columns: 1fr 130px 1.2fr;
  gap: 10px;
  padding: 6px 4px 6px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.mk-rows { display: flex; flex-direction: column; }
.mk-row {
  display: grid;
  grid-template-columns: 1fr 130px 1.2fr;
  gap: 10px;
  align-items: center;
  padding: 5px 4px;
  border-bottom: 1px solid var(--grid-line);
}
.mk-field {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mk-select { min-width: 120px; }
.mk-opts { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 5px; }
.base-input.mk-num {
  width: 44px;
  border-radius: 5px;
  padding: 3px 5px;
  font-size: 12px;
}
.base-input.mk-num.wide { width: 64px; }

.mk-f { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
.mk-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-toolbar);
  flex: none;
}
.mk-summary { font-size: 12px; color: var(--text-faint); margin-left: auto; }
</style>
