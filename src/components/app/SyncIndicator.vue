<script setup>
import { computed, ref, watch, onScopeDispose } from 'vue'
import { useTicker } from '../../composables/useTicker'
import { syncStatus, syncNow } from '../../stores/sync'
import { entitlement } from '../../stores/premium'
import { openModal } from '../../stores/modals'
import { syncView } from '../../utils/syncStatus'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'

// The sync status at the foot of the left rail; syncView decides what it says. The
// clock only ticks while someone is looking, so "3 minutes ago" costs nothing otherwise.
const open = ref(false)
const hovered = ref(false)
const now = useTicker(computed(() => open.value || hovered.value), 30 * 1000)
const view = computed(() => syncView(syncStatus.value, entitlement.value.state, now.value))

function openAccount() {
  open.value = false
  openModal('preferences', undefined, { props: { initialTab: 'account' } })
}

function onKeyDown(e) {
  if (e.key === 'Escape') open.value = false
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('keydown', onKeyDown)
  else document.removeEventListener('keydown', onKeyDown)
})
onScopeDispose(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div v-if="view" class="sync">
    <button
      class="sync-toggle"
      :class="[view.tone, { active: open }]"
      type="button"
      :title="view.label"
      :aria-label="view.label"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @click="open = !open"
    >
      <BaseIcon name="refresh" :size="15" :class="{ spinning: view.spinning }" />
      <span v-if="view.warning" class="sync-dot"></span>
    </button>

    <template v-if="open">
      <div class="sync-backdrop" @mousedown="open = false"></div>
      <div class="sync-pop" role="dialog" aria-label="Sync status">
        <div class="sync-label" :class="view.tone">{{ view.label }}</div>
        <p v-if="view.detail" class="sync-text">{{ view.detail }}</p>
        <p v-if="view.warning" class="sync-text sync-warning">{{ view.warning }}</p>
        <p v-if="view.lastSynced" class="sync-text">{{ view.lastSynced }}</p>
        <div class="sync-actions">
          <BaseButton size="sm" @click="openAccount">Account settings…</BaseButton>
          <BaseButton size="sm" variant="primary" :disabled="view.spinning" @click="syncNow">Sync now</BaseButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sync { position: relative; margin-top: 8px; }
.sync-toggle {
  appearance: none;
  background: none;
  border: none;
  padding: 4px 2px;
  cursor: pointer;
  border-radius: 5px;
  position: relative;
  display: grid;
  place-items: center;
  color: var(--text-dim);
}
.sync-toggle:hover { background: var(--bg-hover); color: var(--text); }
.sync-toggle.muted { color: var(--text-faint); }
.sync-toggle.error { color: var(--danger-text); }
.sync-toggle.active { color: var(--accent); }
.sync-dot {
  position: absolute;
  top: 2px;
  right: 1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
}
.spinning { animation: sync-spin 1s linear infinite; }
@keyframes sync-spin { to { transform: rotate(360deg); } }

.sync-backdrop { position: fixed; inset: 0; z-index: 90; }
.sync-pop {
  position: absolute;
  left: calc(100% + 8px);
  bottom: 0;
  z-index: 91;
  width: 280px;
  background: var(--bg-menu);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6);
  padding: 12px;
}
.sync-label { font-size: 13px; color: var(--text); font-weight: 500; }
.sync-label.error { color: var(--danger-text); }
.sync-text { margin: 6px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-dim); }
.sync-warning { color: var(--warn); }
.sync-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
</style>
