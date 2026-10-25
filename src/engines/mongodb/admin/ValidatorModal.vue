<script setup>
import { ref, onMounted } from 'vue'
import { getValidator, setValidator } from '../api/admin'
import { apiTarget } from '../api/payload'
import { errText } from '../../../utils/errors'
import { resourceName } from '../../../utils/resourceRef'
import { parseField } from '../../../utils/queryParser'
import { showToast } from '../../../stores/toast'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseTextarea from '../../../components/base/BaseTextarea.vue'
import FieldError from '../../../components/base/FieldError.vue'
import FormField from '../../../components/base/FormField.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import BaseModalFoot from '../../../components/base/BaseModalFoot.vue'

// Add / Edit Validator for a collection. Fetches the current validator on open so an
// existing rule is never silently overwritten, then writes changes via collMod.
const props = defineProps({
  target: { type: Object, required: true },  // { resource, connectionName }
})
const emit = defineEmits(['close'])

const loading = ref(true)
const saving = ref(false)
const error = ref(null)
const validatorText = ref('')
const level = ref('strict')   // off | moderate | strict
const action = ref('error')   // error | warn
const LEVEL_OPTIONS = ['off', 'moderate', 'strict'].map((v) => ({ value: v, label: v }))
const ACTION_OPTIONS = ['error', 'warn'].map((v) => ({ value: v, label: v }))

onMounted(async () => {
  try {
    const info = await getValidator(apiTarget(props.target.resource))
    validatorText.value = info.validator || ''
    if (info.validation_level) level.value = info.validation_level
    if (info.validation_action) action.value = info.validation_action
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
})

async function save() {
  // Validate the validator document up front (empty clears the rule).
  const raw = validatorText.value.trim()
  let ejson = ''
  if (raw !== '' && raw !== '{}') {
    const pf = parseField(raw)
    if (!pf.ok) { error.value = pf.error; return }
    ejson = pf.ejson
  }
  saving.value = true
  error.value = null
  try {
    await setValidator(
      apiTarget(props.target.resource),
      ejson,
      level.value,
      action.value,
    )
    showToast(`Validator saved for "${resourceName(props.target.resource)}"`)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Validator — ${resourceName(target.resource)}`" width="620px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <StateMessage v-if="loading" mode="loading" label="Loading validator…" />
        <template v-else>
          <FormField label="Validator (JSON schema document — leave empty to clear)" uppercase>
            <BaseTextarea
              v-model="validatorText"
              class="vd-editor"
              spellcheck="false"
              placeholder='{ "$jsonSchema": { "bsonType": "object", "required": ["name"] } }'
            ></BaseTextarea>
          </FormField>

          <div class="vd-row">
            <FormField label="Validation Level" uppercase class="vd-field">
              <BaseSelect v-model="level" class="vd-select" :options="LEVEL_OPTIONS" />
            </FormField>
            <FormField label="Validation Action" uppercase class="vd-field">
              <BaseSelect v-model="action" class="vd-select" :options="ACTION_OPTIONS" />
            </FormField>
          </div>

          <FieldError :text="error" />
        </template>
      </BaseModalBody>

      <BaseModalFoot>
        <BaseButton bordered @click="$emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="loading || saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </BaseButton>
      </BaseModalFoot>
    </BaseModal>
</template>

<style scoped>

.base-textarea.vd-editor { min-height: 160px; }
.vd-row { display: flex; gap: 12px; }
.vd-field { flex: 1; }
.vd-select { width: 100%; }


</style>
