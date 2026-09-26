<script setup>
import { ref, computed } from 'vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import { KNOWN_OPTION_KEYS, ENGINE_OPTIONS } from '../../data/connectionOptions.js'
import { parseConnectionUri } from '../../utils/connectionUri.js'

const props = defineProps({
  engine: { type: String, default: 'mongodb' },
  // A saved connection can't change engine (the backend refuses it).
  engineLocked: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'next'])

const mode      = ref('uri')
const pastedUri = ref('')
const uriError  = ref('')
const engine    = ref(props.engine)
const isPg      = computed(() => engine.value === 'postgresql')
if (isPg.value) mode.value = 'manual'

// PostgreSQL connection strings aren't parsed yet, so it can only be configured by hand.
function pickEngine(next) {
  engine.value = next
  mode.value = isPg.value ? 'manual' : 'uri'
  uriError.value = ''
}

// Emits the parsed connection string (or null when the user chose to configure the
// connection by hand) and the chosen engine. A string that doesn't parse keeps the dialog here with an error
// rather than opening the form on fields we couldn't fill.
function goNext() {
  if (mode.value === 'manual') {
    emit('next', null, engine.value)
    return
  }

  const raw = pastedUri.value.trim()
  if (!raw) {
    uriError.value = 'Paste a connection string, or choose "Manually configure" below.'
    return
  }

  const parsed = parseConnectionUri(raw, KNOWN_OPTION_KEYS)
  if (!parsed) {
    uriError.value = 'That doesn’t look like a MongoDB connection string (expected mongodb:// or mongodb+srv://).'
    return
  }

  uriError.value = ''
  emit('next', parsed, engine.value)
}
</script>

<template>
  <BaseModal title="New Connection" width="640px" max-width="94vw" @close="$emit('close')">
    <div class="nci-body">
      <div v-if="!engineLocked" class="nci-engine">
        <span class="nci-radio-lbl">Database engine</span>
        <SegmentedControl :model-value="engine" :options="ENGINE_OPTIONS" @update:model-value="pickEngine" />
      </div>

      <p v-if="isPg" class="nci-lead">
        Pasting a PostgreSQL connection string isn't supported yet — configure the connection by hand.
      </p>
      <p v-else class="nci-lead">
        If you have a connection string (SRV or standard), e.g. for your MongoDB deployment,
        you can paste it here and OzenDB will auto-configure your connection settings for you.
      </p>

      <label class="nci-radio" :class="{ off: isPg }" @click="isPg || (mode = 'uri')">
        <span class="radio" :class="{ on: mode === 'uri' }"></span>
        <span class="nci-radio-lbl">Paste your connection string (SRV or standard) here:</span>
      </label>
      <div class="nci-uri-wrap">
        <span class="nci-uri-lbl">URI:</span>
        <BaseTextarea
          class="nci-uri"
          :disabled="mode !== 'uri'"
          v-model="pastedUri"
          placeholder="mongodb+srv://user:password@cluster.mongodb.net/"
        />
      </div>

      <FieldError :text="uriError" class="nci-error" />

      <label class="nci-radio" @click="mode = 'manual'; uriError = ''">
        <span class="radio" :class="{ on: mode === 'manual' }"></span>
        <span class="nci-radio-lbl">Manually configure my connection settings</span>
      </label>
    </div>

    <div class="cm-footer">
      <span class="spacer"></span>
      <BaseButton bordered @click="$emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" @click="goNext">Next</BaseButton>
    </div>
  </BaseModal>
</template>

<style src="./ConnectionIntro.css" scoped></style>
