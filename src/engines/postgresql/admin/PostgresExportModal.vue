<script setup>
import { ref } from 'vue'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { exportData } from '../api/transfer'
import { EXPORT_FORMATS, exportSource, exportLabel, defaultFileName, exportedMessage } from './exportRows'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import FieldError from '../../../components/base/FieldError.vue'
import HintText from '../../../components/base/HintText.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'
import { errText } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'

// Export a table or a SQL editor's query to a file (ozendb-6v3).
const props = defineProps({
  target: { type: Object, required: true },  // { connId, database, schema, table } or { connId, database, query }
})
const emit = defineEmits(['close'])

const format = ref('csv')
const error = ref(null)
const exporting = ref(false)

async function confirm() {
  if (exporting.value) return
  error.value = null
  let path
  try {
    path = await saveDialog({
      defaultPath: defaultFileName(props.target, format.value),
      filters: [{ name: format.value.toUpperCase(), extensions: [format.value] }],
    })
  } catch (e) {
    error.value = errText(e)
    return
  }
  if (!path) return
  exporting.value = true
  try {
    const result = await exportData(
      { connectionId: props.target.connId, database: props.target.database },
      exportSource(props.target), format.value, path,
    )
    showToast(exportedMessage(result))
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <BaseModal title="Export" @close="emit('close')">
    <div class="del-body">
      <HintText>{{ exportLabel(target) }}</HintText>
      <BaseSelect v-model="format" :options="EXPORT_FORMATS" />
      <HintText dim>Every row is exported, not just the first page the grid shows.</HintText>
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <FlexSpacer />
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="exporting" @click="confirm">
        {{ exporting ? 'Exporting…' : 'Export…' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
