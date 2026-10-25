<script setup>
import { ref, onMounted } from 'vue'
import { dropFunction, listFunctions, saveFunction } from '../api/admin'
import { apiTarget } from '../api/payload'
import { errText } from '../../../utils/errors'
import { useConfirmDelete } from '../../../composables/useConfirmDelete'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseTextarea from '../../../components/base/BaseTextarea.vue'
import FieldError from '../../../components/base/FieldError.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import { resourceName } from '../../../utils/resourceRef'

// Add / Edit Stored Functions for a database (its system.js documents).
const props = defineProps({
  target: { type: Object, required: true },  // { resource, connectionName }
})
defineEmits(['close'])

const loading = ref(true)
const busy = ref(false)
const error = ref(null)
const functions = ref([])
const { pendingId: pendingDrop, confirmDelete } = useConfirmDelete()

// The function being edited (null = list view). name is blank for a new one.
const editing = ref(null)   // { name, body } | null
const editError = ref(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    functions.value = await listFunctions(apiTarget(props.target.resource))
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function newFunction() {
  editError.value = null
  editing.value = { name: '', body: 'function () {\n  \n}' }
}

function editFunction(fn) {
  editError.value = null
  editing.value = { name: fn.name, body: fn.body }
}

async function onSaveFunction() {
  const name = editing.value.name.trim()
  if (!name) { editError.value = 'A function name is required'; return }
  busy.value = true
  editError.value = null
  try {
    await saveFunction(
      apiTarget(props.target.resource),
      name,
      editing.value.body,
    )
    editing.value = null
    await load()
  } catch (e) {
    editError.value = errText(e)
  } finally {
    busy.value = false
  }
}

async function onDropFunction(fn) {
  if (!confirmDelete(fn.name)) return
  busy.value = true
  try {
    await dropFunction(apiTarget(props.target.resource), fn.name)
    await load()
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Stored Functions — ${resourceName(target.resource)}`" width="620px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <!-- Editor -->
        <template v-if="editing">
          <BaseInput v-model="editing.name" placeholder="Function name" :disabled="busy" />
          <BaseTextarea v-model="editing.body" class="fn-code" spellcheck="false" placeholder="function () { … }"></BaseTextarea>
          <FieldError :text="editError" />
          <div class="fn-actions">
            <BaseButton bordered @click="editing = null">Back</BaseButton>
            <BaseButton variant="primary" :disabled="!editing.name.trim() || busy" @click="onSaveFunction">Save</BaseButton>
          </div>
        </template>

        <!-- List -->
        <template v-else>
          <div class="fn-bar">
            <BaseButton variant="primary" :disabled="busy" @click="newFunction"><BaseIcon name="plus" :size="12" /> New Function</BaseButton>
          </div>
          <StateMessage v-if="loading" mode="loading" label="Loading functions…" />
          <StateMessage v-else-if="error" mode="error" :message="error" />
          <StateMessage v-else-if="!functions.length" mode="empty" label="No stored functions on this database" />
          <div v-else class="fn-list">
            <div v-for="fn in functions" :key="fn.name" class="fn-row">
              <span class="fn-name">{{ fn.name }}</span>
              <span class="fn-row-act">
                <BaseButton bordered :disabled="busy" @click="editFunction(fn)">Edit</BaseButton>
                <BaseButton bordered :variant="pendingDrop === fn.name ? 'danger' : 'default'" :disabled="busy" @click="onDropFunction(fn)">
                  {{ pendingDrop === fn.name ? 'Confirm' : 'Delete' }}
                </BaseButton>
              </span>
            </div>
          </div>
        </template>
      </BaseModalBody>
    </BaseModal>
</template>

<style scoped>


.fn-bar { display: flex; }
.base-textarea.fn-code { min-height: 220px; }
.fn-actions { display: flex; justify-content: flex-end; gap: 8px; }

.fn-list { display: flex; flex-direction: column; }
.fn-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 6px; border-bottom: 1px solid var(--grid-line); }
.fn-name { font-family: var(--mono); font-size: 12.5px; color: var(--text); }
.fn-row-act { display: flex; gap: 6px; }

</style>
