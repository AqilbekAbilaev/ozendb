<script setup>
import { ref, computed } from 'vue'
import { createDatabase } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'

// Connection → Add Database…: MongoDB only materialises a database once it holds a
// collection, so the first collection name is required rather than optional.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

const dbName = ref('')
const collName = ref('')
const error = ref(null)
const saving = ref(false)

const valid = computed(() => !!dbName.value.trim() && !!collName.value.trim())

async function confirm() {
  if (!valid.value || saving.value) return
  const database = dbName.value.trim()
  saving.value = true
  error.value = null
  try {
    await createDatabase(
      { connectionId: props.target.connId, database: database },
      collName.value.trim(),
    )
    showToast(`Database "${database}" created`)
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
  <BaseModal title="Add Database" @close="emit('close')">
    <div class="del-body">
      <BaseInput
        v-model="dbName"
        class="prompt-input"
        placeholder="Database name"
      />
      <BaseInput
        v-model="collName"
        class="prompt-input"
        style="margin-top:8px"
        placeholder="First collection name"
        @keydown.enter="confirm"
      />
      <p style="margin-top:8px;color:var(--text-faint);font-size:12px">MongoDB only creates a database once it holds a collection, so a first collection is required.</p>
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
