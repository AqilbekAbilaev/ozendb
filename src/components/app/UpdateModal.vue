<script setup>
import { computed } from 'vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'

// Shown when a check finds a newer release. `canInstall` decides whether this is an
// offer to self-update or a pointer at the downloads page — see useUpdater for why a
// deb/rpm install can't be updated in place.
const props = defineProps({
  update:     { type: Object,  default: null },
  canInstall: { type: Boolean, default: false },
  installing: { type: Boolean, default: false },
  downloaded: { type: Number,  default: 0 },
  total:      { type: Number,  default: 0 },
})

defineEmits(['close', 'install', 'downloads'])

const percent = computed(() => {
  if (!props.total) return 0
  return Math.min(100, Math.round((props.downloaded / props.total) * 100))
})
</script>

<template>
  <BaseModal title="Update Available" width="460px" max-width="92vw" @close="$emit('close')">
    <div class="up-body">
      <div class="up-headline">OzenDB {{ update?.version }} is available</div>

      <pre v-if="update?.body" class="up-notes">{{ update.body }}</pre>

      <div v-if="!canInstall" class="up-note">
        This build is installed through your package manager, so it can't update itself.
        The downloads page has the new version.
      </div>

      <div v-if="installing" class="up-progress">
        <div class="up-bar"><div class="up-fill" :style="{ width: percent + '%' }"></div></div>
        <div class="up-pct">{{ total ? percent + '%' : 'Starting…' }}</div>
      </div>
    </div>

    <div class="up-footer">
      <span class="spacer"></span>
      <BaseButton :disabled="installing" @click="$emit('close')">Later</BaseButton>
      <BaseButton
        v-if="canInstall"
        variant="primary"
        :disabled="installing"
        @click="$emit('install')"
      >{{ installing ? 'Installing…' : 'Install and Relaunch' }}</BaseButton>
      <BaseButton v-else variant="primary" @click="$emit('downloads')">Open Downloads</BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.up-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.up-headline { font-size: 15px; font-weight: 600; color: var(--text); }

.up-notes {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.up-note { font-size: 12px; line-height: 1.6; color: var(--text-dim); }

.up-progress { display: flex; align-items: center; gap: 10px; }
.up-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-panel-2);
  overflow: hidden;
}
.up-fill {
  height: 100%;
  background: var(--accent);
  transition: width .15s linear;
}
.up-pct { font-size: 12px; color: var(--text-dim); min-width: 62px; text-align: right; }

.up-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
}
.spacer { flex: 1; }
</style>
