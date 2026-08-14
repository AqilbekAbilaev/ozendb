<script setup>
import { ref } from 'vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'
import { KNOWN_OPTION_KEYS } from '../../data/connectionOptions.js'
import { parseConnectionUri } from '../../utils/connectionUri.js'

const emit = defineEmits(['close', 'next'])

const mode      = ref('uri')
const pastedUri = ref('')
const uriError  = ref('')

// Emits the parsed connection string, or null when the user chose to configure the
// connection by hand. A string that doesn't parse keeps the dialog here with an error
// rather than opening the form on fields we couldn't fill.
function goNext() {
  if (mode.value === 'manual') {
    emit('next', null)
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
  emit('next', parsed)
}
</script>

<template>
  <BaseModal title="New Connection" width="640px" max-width="94vw" @close="$emit('close')">
    <div class="nci-body">
      <p class="nci-lead">
        If you have a connection string (SRV or standard), e.g. for your MongoDB deployment,
        you can paste it here and OzenDB will auto-configure your connection settings for you.
      </p>

      <label class="nci-radio" @click="mode = 'uri'">
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
