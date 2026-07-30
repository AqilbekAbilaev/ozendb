<script setup>
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseRadio from '../base/BaseRadio.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { buildCollectionOptions, emptyCollectionOptions } from '../../utils/collectionOptions'

// Database → Add Collection…: name plus the collection type and that type's options
// (mirrors 3T's dialog). The per-type field rules live in utils/collectionOptions.js so
// they stay unit tested; this component only binds inputs and surfaces the error.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

// Time-series granularity choices for the BaseSelect.
const GRANULARITY_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
]

const name = ref('')
const type = ref('standard')   // 'standard' | 'capped' | 'timeseries' | 'clustered'
// Kept as strings so the inputs bind directly; coerced when the request is built.
const opts = ref(emptyCollectionOptions())
const error = ref(null)
const saving = ref(false)

async function confirm() {
  const collection = name.value.trim()
  if (!collection || saving.value) return
  const built = buildCollectionOptions(type.value, opts.value)
  if (!built.ok) { error.value = built.error; return }
  saving.value = true
  error.value = null
  try {
    await invoke('create_collection', {
      id: props.target.connId,
      database: props.target.dbName,
      name: collection,
      options: built.options,
    })
    showToast(`Collection "${collection}" created`)
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
  <BaseModal title="Add Collection" @close="emit('close')">
    <div class="del-body">
      <BaseInput
        v-model="name"
        class="prompt-input"
        placeholder="Collection name"
        @keydown.enter="confirm"
      />
      <div class="cc-types">
        <label class="cc-type"><BaseRadio value="standard" v-model="type" /> Standard</label>
        <label class="cc-type"><BaseRadio value="capped" v-model="type" /> Capped</label>
        <label class="cc-type"><BaseRadio value="timeseries" v-model="type" /> Time-series</label>
        <label class="cc-type"><BaseRadio value="clustered" v-model="type" /> Clustered</label>
      </div>

      <div v-if="type === 'capped'" class="cc-opts">
        <label class="cc-field">
          <span class="cc-label">Max size (bytes)</span>
          <BaseInput v-model="opts.size" class="prompt-input" type="number" min="1" placeholder="e.g. 1048576" @keydown.enter="confirm" />
        </label>
        <label class="cc-field">
          <span class="cc-label">Max documents <span class="cc-opt">(optional)</span></span>
          <BaseInput v-model="opts.max" class="prompt-input" type="number" min="1" placeholder="e.g. 1000" @keydown.enter="confirm" />
        </label>
      </div>

      <div v-else-if="type === 'timeseries'" class="cc-opts">
        <label class="cc-field">
          <span class="cc-label">Time field</span>
          <BaseInput v-model="opts.timeField" class="prompt-input" placeholder="e.g. timestamp" @keydown.enter="confirm" />
        </label>
        <label class="cc-field">
          <span class="cc-label">Meta field <span class="cc-opt">(optional)</span></span>
          <BaseInput v-model="opts.metaField" class="prompt-input" placeholder="e.g. metadata" @keydown.enter="confirm" />
        </label>
        <label class="cc-field">
          <span class="cc-label">Granularity <span class="cc-opt">(optional)</span></span>
          <BaseSelect v-model="opts.granularity" class="prompt-select" :options="GRANULARITY_OPTIONS" />
        </label>
        <label class="cc-field">
          <span class="cc-label">Expire after (seconds) <span class="cc-opt">(optional)</span></span>
          <BaseInput v-model="opts.expireAfterSeconds" class="prompt-input" type="number" min="1" placeholder="e.g. 86400" @keydown.enter="confirm" />
        </label>
      </div>

      <div v-else-if="type === 'clustered'" class="cc-opts">
        <p class="cc-hint">Documents are stored in <code>_id</code> order (clustered index on <code>{ _id: 1 }</code>).</p>
        <label class="cc-field">
          <span class="cc-label">Index name <span class="cc-opt">(optional)</span></span>
          <BaseInput v-model="opts.clusteredIndexName" class="prompt-input" placeholder="e.g. events_clustered" @keydown.enter="confirm" />
        </label>
      </div>

      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!name.trim() || saving" @click="confirm">
        {{ saving ? 'Creating…' : 'Create' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
