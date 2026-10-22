<script setup>
import { useSyncSetup } from '../../composables/useSyncSetup'
import { showToast } from '../../stores/toast'
import { MIN_SYNC_PASSWORD } from '../../utils/syncPassword'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'
import SyncKeysSection from './SyncKeysSection.vue'

// Setting sync up on this device, in the Account tab once signed in.
const {
  step, recoveryAvailable, unlockWith, password, confirmation, typedRecoveryKey,
  recoveryKey, recoveryKeySaved, busy, error, checkAgain, choose, finish, unlock,
} = useSyncSetup()

function copyRecoveryKey() {
  navigator.clipboard.writeText(recoveryKey.value).then(() => showToast('Copied'), () => showToast('Could not copy'))
}
</script>

<template>
  <div class="ss-section">
    <div class="ss-label">Sync</div>

    <HintText v-if="step === 'checking'">Checking sync…</HintText>

    <HintText v-else-if="step === 'premium_needed'">Syncing your connections and queries between devices needs OzenDB Premium.</HintText>

    <SyncKeysSection v-else-if="step === 'set_up'" @turned-off="checkAgain" />

    <template v-else-if="step === 'failed'">
      <div class="ss-row">
        <FieldError class="ss-grow" :text="error" />
        <BaseButton @click="checkAgain">Try again</BaseButton>
      </div>
    </template>

    <template v-else-if="step === 'choose'">
      <HintText>
        Choose a sync password. It encrypts your data before it leaves this device, so nobody else can read it,
        not even OzenDB. Use at least {{ MIN_SYNC_PASSWORD }} characters.
      </HintText>
      <BaseInput v-model="password" type="password" placeholder="Sync password" :disabled="busy" />
      <BaseInput v-model="confirmation" type="password" placeholder="Type it again" :disabled="busy" @enter="choose" />
      <div class="ss-row">
        <HintText class="ss-grow">{{ busy ? 'Making your keys…' : '' }}</HintText>
        <BaseButton variant="primary" :disabled="busy || !password" @click="choose">Continue</BaseButton>
      </div>
    </template>

    <template v-else-if="step === 'recovery_key'">
      <HintText>
        This is your recovery key. If you forget your sync password, it is the only way back to your synced data.
        Save it somewhere safe now: it will not be shown again.
      </HintText>
      <div class="ss-row">
        <div class="ss-key ss-grow">{{ recoveryKey }}</div>
        <BaseButton @click="copyRecoveryKey">Copy</BaseButton>
      </div>
      <BaseCheckbox v-model="recoveryKeySaved" label="I have saved my recovery key somewhere safe" />
      <div class="ss-row">
        <span class="ss-grow" />
        <BaseButton variant="primary" :disabled="!recoveryKeySaved" @click="finish">Start syncing</BaseButton>
      </div>
    </template>

    <HintText v-else-if="step === 'finishing'">Uploading this device's data…</HintText>

    <template v-else-if="step === 'retry'">
      <div class="ss-row">
        <HintText class="ss-grow">The first upload has not gone through yet. Your recovery key stays the same.</HintText>
        <BaseButton variant="primary" :disabled="busy" @click="finish">Try again</BaseButton>
      </div>
    </template>

    <template v-else-if="step === 'unlock'">
      <HintText>
        Sync is already set up on another device.
        {{ unlockWith === 'password' ? 'Enter its sync password' : 'Enter your recovery key' }} to join it.
        Connections you made on both devices separately will appear twice.
      </HintText>
      <BaseInput
        v-if="unlockWith === 'password'"
        v-model="password"
        type="password"
        placeholder="Sync password"
        :disabled="busy"
        @enter="unlock"
      />
      <BaseInput
        v-else
        v-model="typedRecoveryKey"
        class="ss-mono"
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
        :disabled="busy"
        @enter="unlock"
      />
      <div class="ss-row">
        <BaseButton
          v-if="recoveryAvailable"
          variant="ghost"
          :disabled="busy"
          @click="unlockWith = unlockWith === 'password' ? 'recovery_key' : 'password'"
        >
          {{ unlockWith === 'password' ? 'Use the recovery key instead' : 'Use the sync password instead' }}
        </BaseButton>
        <HintText class="ss-grow">{{ busy ? 'Unlocking…' : '' }}</HintText>
        <BaseButton variant="primary" :disabled="busy" @click="unlock">Unlock</BaseButton>
      </div>
    </template>

    <FieldError v-if="step !== 'failed'" :text="error" />
  </div>
</template>

<style scoped>
.ss-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.ss-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ss-grow { flex: 1; min-width: 0; }
.ss-label { font-size: 13px; color: var(--text); }
.ss-key {
  font-family: var(--mono);
  font-size: 15px;
  letter-spacing: 0.05em;
  color: var(--text);
  user-select: all;
}
.ss-mono { font-family: var(--mono); }
</style>
