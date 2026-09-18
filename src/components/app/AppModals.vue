<script setup>
import { inject, unref } from 'vue'
import { MODALS } from '../../constants/modalRegistry'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import FieldError from '../base/FieldError.vue'
import { indexSpecJson } from '../../utils/indexSpec'
import SshHostKeyModal from '../connection/SshHostKeyModal.vue'
import { openModals, closeModal, modalOptions } from '../../stores/modals'
import { renameTabTarget, renameTabValue, confirmRenameTab } from '../../stores/tabs'

// indexes/ssh still come through App.vue's appModals provide — see the comment there
// for why useIndexes/useSshHostKey can't be module-scope stores yet.
const ctx = inject('appModals')

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

// The Index Manager list/form now lives in IndexManagerPane (the 'indexes' tab).
// AppModals only keeps the two index dialogs that overlay it: View Details and the
// type-to-confirm Drop.
const {
  indexDetailsTarget,
  indexDetailsStats,
  indexDetailsLoading,
  dropIndexTarget,
  dropIndexConfirmText,
  dropIndexError,
  dropIndexBusy,
  confirmDropIndex,
  formatIndexSince,
} = ctx.indexes

const {
  sshHostKeyPrompt,
  sshHostKeyChanged,
  onHostKeyTrust,
  onHostKeyCancel,
  onHostKeyForget,
} = ctx.ssh
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
          <span class="spacer"></span>
          <BaseButton @click="renameTabTarget = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="!renameTabValue.trim()" @click="confirmRenameTab">Rename</BaseButton>
        </div>
  </BaseModal>

    <!-- Index: View Details (read-only) -->
    <BaseModal v-if="indexDetailsTarget" :title="`Index Details — ${indexDetailsTarget.name}`" width="560px" @close="indexDetailsTarget = null">
        <div class="del-body">
          <div class="idx-detail-section">Definition</div>
          <pre class="idx-detail-json">{{ indexSpecJson(indexDetailsTarget) }}</pre>
          <div class="idx-detail-section">Usage</div>
          <div v-if="indexDetailsLoading" class="idx-msg">Loading usage…</div>
          <table v-else-if="indexDetailsStats" class="idx-detail-stats">
            <tbody>
              <tr><td>Operations</td><td>{{ indexDetailsStats.accesses?.ops ?? '—' }}</td></tr>
              <tr><td>Tracking since</td><td>{{ formatIndexSince(indexDetailsStats.accesses?.since) }}</td></tr>
            </tbody>
          </table>
          <div v-else class="idx-msg">Usage statistics unavailable.</div>
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="indexDetailsTarget = null">Close</BaseButton>
        </div>
  </BaseModal>

    <!-- Index: Drop confirmation (type the name to confirm) -->
    <BaseModal v-if="dropIndexTarget" title="Drop Index" @close="dropIndexTarget = null">
        <div class="del-body">
          <p>This permanently drops the index
            <code>{{ dropIndexTarget.name }}</code> from
            <code>{{ dropIndexTarget.dbName }}.{{ dropIndexTarget.collName }}</code>.
            Queries that relied on it may slow down.
            This cannot be undone.</p>
          <p class="cc-prompt">Type <code>{{ dropIndexTarget.name }}</code> to confirm:</p>
          <BaseInput
            class="prompt-input"
            v-model="dropIndexConfirmText"
            autocomplete="off"
            @keydown.enter="confirmDropIndex"
          />
          <FieldError :text="dropIndexError" spaced />
        </div>
        <div class="del-footer">
          <span class="spacer"></span>
          <BaseButton @click="dropIndexTarget = null">Cancel</BaseButton>
          <BaseButton
            variant="danger"
            :disabled="dropIndexBusy || dropIndexConfirmText !== dropIndexTarget.name"
            @click="confirmDropIndex"
          >{{ dropIndexBusy ? 'Dropping…' : 'Drop Index' }}</BaseButton>
        </div>
  </BaseModal>
</template>
