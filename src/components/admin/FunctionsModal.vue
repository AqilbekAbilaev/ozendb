<script setup>
import { ref, onMounted } from 'vue'
import { dropFunction, listFunctions, saveFunction } from '../../engines/mongodb/api/admin'
import { errText } from '../../utils/errors'
import { useConfirmDelete } from '../../composables/useConfirmDelete'
import BaseIcon from '../base/BaseIcon.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'
import BaseModalBody from '../base/BaseModalBody.vue'

// Add / Edit Stored Functions for a database (its system.js documents).
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName }
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
    functions.value = await listFunctions({ connectionId: props.target.connId, database: props.target.dbName })
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

async function saveFunction() {
  const name = editing.value.name.trim()
  if (!name) { editError.value = 'A function name is required'; return }
  busy.value = true
  editError.value = null
  try {
    await saveFunction(
      { connectionId: props.target.connId, database: props.target.dbName },
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

async function dropFunction(fn) {
  if (!confirmDelete(fn.name)) return
  busy.value = true
  try {
    await dropFunction({ connectionId: props.target.connId, database: props.target.dbName }, fn.name)
    await load()
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Stored Functions — ${target.dbName}`" width="620px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <!-- Editor -->
        <template v-if="editing">
          <BaseInput v-model="editing.name" placeholder="Function name" :disabled="busy" />
          <BaseTextarea v-model="editing.body" class="fn-code" spellcheck="false" placeholder="function () { … }"></BaseTextarea>
          <FieldError :text="editError" />
          <div class="fn-actions">
            <BaseButton bordered @click="editing = null">Back</BaseButton>
            <BaseButton variant="primary" :disabled="!editing.name.trim() || busy" @click="saveFunction">Save</BaseButton>
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
                <BaseButton bordered :variant="pendingDrop === fn.name ? 'danger' : 'default'" :disabled="busy" @click="dropFunction(fn)">
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
