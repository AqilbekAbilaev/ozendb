<script setup>
import { ref, computed, onMounted } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { importPreview, importCsv } from '../api/transfer'
import { columnOptions, mappedCount, importedMessage, toSelections, toMapping } from './importRows'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import FieldError from '../../../components/base/FieldError.vue'
import HintText from '../../../components/base/HintText.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'
import { errText } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'

// Import a CSV into a table (#128): pick a file, check the column mapping against
// the first rows, then import it in one transaction.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, database, schema, table }
})
const emit = defineEmits(['close'])

const table = computed(() => ({
  connectionId: props.target.connId, database: props.target.database,
  schema: props.target.schema, table: props.target.table,
}))
const path = ref(null)
const preview = ref(null)
const selections = ref([])
const loading = ref(false)
const importing = ref(false)
const error = ref(null)
const options = computed(() => (preview.value ? columnOptions(preview.value.columns) : []))

async function chooseFile() {
  error.value = null
  let picked
  try {
    picked = await openDialog({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] })
  } catch (e) {
    error.value = errText(e)
    return
  }
  if (!picked) return
  path.value = picked
  loading.value = true
  try {
    preview.value = await importPreview(table.value, picked)
    selections.value = toSelections(preview.value.mapping)
  } catch (e) {
    preview.value = null
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}
onMounted(chooseFile)

async function confirm() {
  if (importing.value || !preview.value) return
  importing.value = true
  error.value = null
  try {
    const rows = await importCsv(table.value, path.value, toMapping(selections.value))
    showToast(importedMessage(rows))
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Import CSV — ${target.schema}.${target.table}`" width="720px" max-width="calc(100vw - 40px)" @close="emit('close')">
    <div class="del-body">
      <StateMessage v-if="loading" mode="loading" label="Reading the file…" />
      <template v-else-if="preview">
        <HintText dim>Map each CSV column to a table column. Empty fields import as NULL; one bad row cancels the whole import.</HintText>
        <div class="imp-wrap">
          <table class="imp-table">
            <thead>
              <tr><th v-for="(h, i) in preview.headers" :key="i">{{ h }}</th></tr>
              <tr>
                <th v-for="(h, i) in preview.headers" :key="i">
                  <BaseSelect v-model="selections[i]" size="sm" :options="options" />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, r) in preview.rows" :key="r">
                <td v-for="(h, i) in preview.headers" :key="i">{{ row[i] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <BaseButton @click="chooseFile">Choose file…</BaseButton>
      <FlexSpacer />
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!preview || importing || !mappedCount(selections)" @click="confirm">
        {{ importing ? 'Importing…' : 'Import' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.imp-wrap { max-height: 360px; overflow: auto; border: 1px solid var(--border-soft); border-radius: 7px; margin-top: 8px; }
.imp-table { border-collapse: collapse; font-size: 12px; width: max-content; min-width: 100%; }
.imp-table th, .imp-table td { padding: 4px 8px; border-bottom: 1px solid var(--border-soft); text-align: left; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.imp-table thead th { position: sticky; top: 0; background: var(--bg-field); font-weight: 600; }
</style>
