<script setup>
import { useSyncKeys } from '../../composables/useSyncKeys'
import { showToast } from '../../stores/toast'
import { MIN_SYNC_PASSWORD } from '../../utils/syncPassword'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'

// Once sync is set up here: a new sync password, or a new recovery key.
const {
  step, password, confirmation, recoveryKey, recoveryKeySaved, busy, error, notice,
  startPasswordChange, changePassword, askForRecoveryKey, replaceRecoveryKey, doneWithRecoveryKey, cancel,
} = useSyncKeys()

function copyRecoveryKey() {
  navigator.clipboard.writeText(recoveryKey.value).then(() => showToast('Copied'), () => showToast('Could not copy'))
}
</script>

<template>
  <div class="sk-row" v-if="step === 'idle'">
    <HintText class="sk-grow">{{ notice || 'Sync is set up on this device.' }}</HintText>
    <BaseButton @click="startPasswordChange">Change password…</BaseButton>
    <BaseButton @click="askForRecoveryKey">New recovery key…</BaseButton>
  </div>

  <template v-else-if="step === 'password'">
    <HintText>
      Choose a new sync password, at least {{ MIN_SYNC_PASSWORD }} characters. Devices already syncing carry on;
      use the new password to set up sync on any other device.
    </HintText>
    <BaseInput v-model="password" type="password" placeholder="New sync password" :disabled="busy" />
    <BaseInput v-model="confirmation" type="password" placeholder="Type it again" :disabled="busy" @enter="changePassword" />
    <div class="sk-row">
      <HintText class="sk-grow">{{ busy ? 'Changing the password…' : '' }}</HintText>
      <BaseButton :disabled="busy" @click="cancel">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="busy || !password" @click="changePassword">Change password</BaseButton>
    </div>
  </template>

  <template v-else-if="step === 'recovery_confirm'">
    <HintText>Make a new recovery key? The one you saved before will stop working.</HintText>
    <div class="sk-row">
      <HintText class="sk-grow">{{ busy ? 'Making a new recovery key…' : '' }}</HintText>
      <BaseButton :disabled="busy" @click="cancel">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="busy" @click="replaceRecoveryKey">Make a new key</BaseButton>
    </div>
  </template>

  <template v-else-if="step === 'recovery_key'">
    <HintText>This is your new recovery key. Save it somewhere safe now: it will not be shown again.</HintText>
    <div class="sk-row">
      <div class="sk-key sk-grow">{{ recoveryKey }}</div>
      <BaseButton @click="copyRecoveryKey">Copy</BaseButton>
    </div>
    <BaseCheckbox v-model="recoveryKeySaved" label="I have saved my new recovery key somewhere safe" />
    <div class="sk-row">
      <span class="sk-grow" />
      <BaseButton variant="primary" :disabled="!recoveryKeySaved" @click="doneWithRecoveryKey">Done</BaseButton>
    </div>
  </template>

  <FieldError :text="error" />
</template>

<style scoped>
.sk-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sk-grow { flex: 1; min-width: 0; }
.sk-key {
  font-family: var(--mono);
  font-size: 15px;
  letter-spacing: 0.05em;
  color: var(--text);
  user-select: all;
}
</style>
