<script setup>
import { ref, computed } from 'vue'
import { createView } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { parsePipeline } from '../../utils/queryParser'
import { useToast } from '../../composables/useToast'

// Add View… (from a database node) opens with no source; Add View Here… (from a
// collection node) prefills that collection — the caller seeds `target.source`.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName, source }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

const name = ref('')
const source = ref(props.target.source || '')
const pipeline = ref('')
const error = ref(null)
const saving = ref(false)

const valid = computed(() => !!name.value.trim() && !!source.value.trim())

async function confirm() {
  if (!valid.value || saving.value) return
  const viewName = name.value.trim()
  // Validate the (optional) pipeline up front so a typo surfaces before the round-trip.
  const pp = parsePipeline(pipeline.value)
  if (!pp.ok) { error.value = pp.error; return }
  saving.value = true
  error.value = null
  try {
    await createView(
      { connectionId: props.target.connId, database: props.target.dbName },
      viewName,
      source.value.trim(),
      pp.ejson,
    )
    showToast(`View "${viewName}" created`)
    emit('saved', props.target.connId)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Add View" @close="emit('close')">
    <div class="del-body">
      <BaseInput
        v-model="name"
        class="prompt-input"
        placeholder="View name"
      />
      <BaseInput
        v-model="source"
        class="prompt-input"
        placeholder="Source collection (viewOn)"
      />
      <BaseTextarea
        v-model="pipeline"
        class="pipeline-input"
        placeholder="Aggregation pipeline (optional), e.g. [ { &quot;$match&quot;: { &quot;active&quot;: true } } ]"
        spellcheck="false"
      ></BaseTextarea>
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid || saving" @click="confirm">
        {{ saving ? 'Creating…' : 'Create' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
