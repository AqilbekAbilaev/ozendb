<script setup>
import { ref, onMounted } from 'vue'
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import FlexSpacer from '../base/FlexSpacer.vue'

// Help → About. Shows the real application name/version reported by the Tauri
// runtime (never hardcoded), plus the build's Tauri version.
defineEmits(['close'])

const name = ref('OzenDB')
const version = ref('')
const tauriVersion = ref('')

onMounted(async () => {
  try {
    name.value = await getName()
    version.value = await getVersion()
    tauriVersion.value = await getTauriVersion()
  } catch (e) {
    // Outside the Tauri runtime (e.g. plain vite dev) these are unavailable; leave
    // the fields blank rather than showing a misleading value.
  }
})
</script>

<template>
  <BaseModal title="About" width="380px" max-width="92vw" @close="$emit('close')">
      <div class="ab-body">
        <div class="ab-name">{{ name }}</div>
        <div class="ab-version" v-if="version">Version {{ version }}</div>
        <div class="ab-meta">
          <div v-if="tauriVersion">Built with Tauri {{ tauriVersion }}</div>
          <div>A cross-platform database GUI.</div>
        </div>
      </div>

      <div class="ab-footer">
        <FlexSpacer />
        <BaseButton variant="primary" @click="$emit('close')">Close</BaseButton>
      </div>
  </BaseModal>
</template>

<style scoped>
.ab-body {
  padding: 24px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ab-name { font-size: 18px; font-weight: 600; color: var(--text); }
.ab-version { font-size: 13px; color: var(--text-dim); }
.ab-meta { margin-top: 10px; font-size: 12px; color: var(--text-faint); line-height: 1.6; }

.ab-footer {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
</style>
