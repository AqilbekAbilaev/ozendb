<script setup>
import { ref, onMounted } from 'vue'
import { getValidator, setValidator } from '../../engines/mongodb/api/admin'
import { errText } from '../../utils/errors'
import { parseField } from '../../utils/queryParser'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'
import FormField from '../base/FormField.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModalFoot from '../base/BaseModalFoot.vue'

// Add / Edit Validator for a collection. Fetches the current validator on open so an
// existing rule is never silently overwritten, then writes changes via collMod.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName, collName }
})
const emit = defineEmits(['close', 'saved'])

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
    const info = await getValidator(
      { connectionId: props.target.connId, database: props.target.dbName, collection: props.target.collName },
    )
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
      { connectionId: props.target.connId, database: props.target.dbName, collection: props.target.collName },
      ejson,
      level.value,
      action.value,
    )
    emit('saved', props.target.collName)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Validator — ${target.collName}`" width="620px" max-width="92vw" @close="$emit('close')">

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
