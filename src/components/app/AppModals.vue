<script setup>
import { unref } from 'vue'
import { useSshHostKey } from '../../composables/useSshHostKey'
import { MODALS } from '../../constants/modalRegistry'
import { MOUNTED_DIALOGS } from '../../engines/ui.js'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import SshHostKeyModal from '../connection/SshHostKeyModal.vue'
import { openModals, closeModal, modalOptions } from '../../stores/modals'
import { renameTabTarget, renameTabValue, confirmRenameTab } from '../../stores/tabs'
import FlexSpacer from '../base/FlexSpacer.vue'

// Registry-driven modals are bound generically: every modal gets `close`; node-targeted
// modals get their payload as `target`; the opener owns any session props and events.
function modalListeners(id) {
  const session = modalOptions(id)
  return { ...(session.on || {}), close: () => closeModal(id) }
}
function modalBindings(id, payload) {
  const session = modalOptions(id)
  const sessionProps = unref(session.props) || {}
  const extra = {
    ...Object.fromEntries(Object.entries(sessionProps).map(([key, value]) => [key, unref(value)])),
  }
  return MODALS[id].level ? { target: payload, ...extra } : extra
}
// Keyed on the target, not just the id, so re-opening a dialog for a different node
// remounts it. Dialogs that prefill a form field from `target` (rename/duplicate/add-view)
// read it once at setup, so a payload swap under a live instance would keep the old value.
function modalKey(id, payload) {
  return id + '|' + JSON.stringify(payload || {})
}

const {
  sshHostKeyPrompt,
  sshHostKeyChanged,
  onHostKeyTrust,
  onHostKeyCancel,
  onHostKeyForget,
} = useSshHostKey()
</script>

<template>
    <!-- Every registry-driven modal renders from this one block. `close` is always wired;
         node-targeted modals get their `target`, and openers provide extra session options. -->
    <component
      v-for="(payload, id) in openModals"
      :is="MODALS[id].component"
      :key="modalKey(id, payload)"
      v-bind="modalBindings(id, payload)"
      v-on="modalListeners(id)"
    />

    <!-- SSH host-key trust prompt / changed-key warning -->
    <SshHostKeyModal
      :prompt="sshHostKeyPrompt"
      :changed="sshHostKeyChanged"
      @trust="onHostKeyTrust"
      @cancel="onHostKeyCancel"
      @forget="onHostKeyForget"
      @dismiss="sshHostKeyChanged = null"
    />

    <!-- Rename Tab modal -->
    <BaseModal v-if="renameTabTarget" title="Rename Tab" @close="renameTabTarget = null">
        <div class="del-body">
          <BaseInput
            v-model="renameTabValue"
            class="prompt-input"
            placeholder="Tab name"
            @keydown.enter="confirmRenameTab"
            @keydown.escape="renameTabTarget = null"
          />
        </div>
        <div class="del-footer">
          <FlexSpacer />
          <BaseButton @click="renameTabTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!renameTabValue.trim()" @click="confirmRenameTab">Rename</BaseButton>
        </div>
  </BaseModal>

    <!-- Dialogs an engine keeps mounted app-wide, showing themselves from their own stores -->
    <component v-for="(dialog, i) in MOUNTED_DIALOGS" :is="dialog" :key="i" />
</template>
