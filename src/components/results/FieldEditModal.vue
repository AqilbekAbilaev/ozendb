<script setup>
// Small dialog behind the Document menu's field editors:
//   mode 'edit'   → change a field's value and BSON type
//   mode 'add'    → add a new field (name + type + value)
//   mode 'rename' → rename a field (name only)
// It builds the Extended-JSON value with the shared docEdit helpers and validates
// locally; the parent performs the actual document mutation + save and can feed a
// backend error back in via `saveError` (the dialog stays open on error).
import { ref, computed, watch } from 'vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import { BSON_TYPES, buildTypedValue } from '../../utils/docEdit'
import BaseModal from '../base/BaseModal.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModalFoot from '../base/BaseModalFoot.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'
import FormField from '../base/FormField.vue'

const typeOptions = BSON_TYPES.map((t) => ({ value: t, label: t }))

const props = defineProps({
  mode:        { type: String, required: true },   // 'edit' | 'add' | 'rename'
  fieldName:   { type: String, default: '' },      // current name (edit / rename)
  initialType: { type: String, default: 'String' },
  initialRaw:  { type: String, default: '' },
  saveError:   { type: String, default: null },    // error from the parent's save
})
const emit = defineEmits(['close', 'save'])

const name  = ref(props.fieldName)
const type  = ref(props.initialType)
const raw   = ref(props.initialRaw)
const localError = ref(null)

// Re-seed if the dialog is reused for a different field without unmounting.
watch(() => [props.fieldName, props.initialType, props.initialRaw], () => {
  name.value = props.fieldName
  type.value = props.initialType
  raw.value  = props.initialRaw
})

const title = computed(() => ({
  edit:   'Edit Value / Type',
  add:    'Add Field / Value',
  rename: 'Rename Field in Document',
}[props.mode]))

const showName  = computed(() => props.mode === 'add' || props.mode === 'rename')
const showValue = computed(() => props.mode === 'add' || props.mode === 'edit')
// Null and JSON aside, the value input is a single line; JSON gets a textarea.
const useTextarea = computed(() => showValue.value && type.value === 'JSON')
const showValueInput = computed(() => showValue.value && type.value !== 'Null')

function onSave() {
  localError.value = null
  if (props.mode === 'rename') {
    const trimmed = name.value.trim()
    if (!trimmed) { localError.value = 'Enter a new field name'; return }
    emit('save', { name: trimmed })
    return
  }
  if (props.mode === 'add') {
    if (!name.value.trim()) { localError.value = 'Enter a field name'; return }
  }
  let value
  try {
    value = buildTypedValue(type.value, raw.value)
  } catch (e) {
    localError.value = e.message
    return
  }
  emit('save', { name: props.mode === 'edit' ? props.fieldName : name.value.trim(), value: value })
}

const shownError = computed(() => localError.value || props.saveError)
</script>

<template>
  <BaseModal :title="`${title}`" width="460px" max-width="94vw" @close="$emit('close')">

      <BaseModalBody>
        <div v-if="mode === 'edit'" class="fe-field-label">Field: <code>{{ fieldName }}</code></div>

        <FormField v-if="showName" :label="mode === 'rename' ? 'New name' : 'Field name'">
          <BaseInput class="fe-input" v-model="name" autocomplete="off"
                 @enter="onSave" />
        </FormField>

        <HintText v-if="mode === 'rename'" class="fe-hint">
          Renames this field on the selected document only.
        </HintText>

        <FormField v-if="showValue" label="Type">
          <BaseSelect class="fe-select" v-model="type" :options="typeOptions" />
        </FormField>

        <FormField v-if="showValueInput" label="Value">
          <BaseTextarea v-if="useTextarea" class="fe-area" v-model="raw" spellcheck="false"
                    autocomplete="off"></BaseTextarea>
          <BaseInput v-else class="fe-input" v-model="raw" autocomplete="off"
                 @enter="onSave" />
        </FormField>

        <FieldError :text="shownError" />
      </BaseModalBody>

      <BaseModalFoot>
        <BaseButton @click="$emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" @click="onSave">Save</BaseButton>
      </BaseModalFoot>
    </BaseModal>
</template>

<style scoped>
.fe-field-label { font-size: 12.5px; color: var(--text-dim); }
.fe-field-label code { font-family: var(--mono); color: var(--text); }
.fe-input,
.base-input.fe-input {
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 5px;
  color: var(--text); font-family: var(--mono); font-size: 12.5px; padding: 7px 9px; outline: none;
}
.fe-input:focus,
.base-input.fe-input:focus { border-color: var(--accent); }
.fe-select { width: 100%; }
.base-textarea.fe-area { min-height: 96px; }
.fe-hint { margin: -4px 0 0; }

</style>
