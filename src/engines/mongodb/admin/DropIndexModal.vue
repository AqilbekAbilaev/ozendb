<script setup>
import * as indexesStore from './indexes'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import FieldError from '../../../components/base/FieldError.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Index: Drop confirmation (type the name to confirm), over the Index Manager tab. Always
// mounted (see MOUNTED_DIALOGS in engines/ui.js); it shows itself while indexes.js holds
// a drop target, which stays frozen if the user switches tabs meanwhile.
const {
  dropIndexTarget,
  dropIndexConfirmText,
  dropIndexError,
  dropIndexBusy,
  confirmDropIndex,
} = indexesStore
</script>

<template>
  <BaseModal v-if="dropIndexTarget" title="Drop Index" @close="dropIndexTarget = null">
      <div class="del-body">
        <p>This permanently drops the index
          <code>{{ dropIndexTarget.name }}</code> from
          <code>{{ dropIndexTarget.dbName }}.{{ dropIndexTarget.collectionName }}</code>.
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
        <FlexSpacer />
        <BaseButton @click="dropIndexTarget = null">Cancel</BaseButton>
        <BaseButton
          variant="danger"
          :disabled="dropIndexBusy || dropIndexConfirmText !== dropIndexTarget.name"
          @click="confirmDropIndex"
        >{{ dropIndexBusy ? 'Dropping…' : 'Drop Index' }}</BaseButton>
      </div>
  </BaseModal>
</template>
