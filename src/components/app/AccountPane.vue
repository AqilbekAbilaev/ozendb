<script setup>
import { computed, ref } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAccountSignIn } from '../../composables/useAccountSignIn'
import { entitlement } from '../../stores/premium'
import { showToast } from '../../stores/toast'
import { planText } from '../../utils/accountPlan'
import { MANAGE_SUBSCRIPTION_URL } from '../../constants/accountLinks'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'
import SyncSetupSection from './SyncSetupSection.vue'

// The OzenDB account in Preferences. Signing in and out take effect at once, apart
// from the dialog's Save and Cancel.
const { step, account, code, notice, error, signingOut, start, cancel, signOut } = useAccountSignIn()
const email = ref('')
const plan = computed(() => planText(entitlement.value, account.value?.subscription))

function manageSubscription() {
  openUrl(MANAGE_SUBSCRIPTION_URL).catch(() => showToast('Could not open link'))
}
</script>

<template>
  <div class="ac-pane">
    <template v-if="step === 'signed_in'">
      <div class="ac-row">
        <div class="ac-meta">
          <div class="ac-label">{{ account.email || 'Signed in' }}</div>
          <HintText class="ac-hint">{{ plan }}</HintText>
        </div>
        <BaseButton v-if="account.subscription" @click="manageSubscription">Manage subscription</BaseButton>
        <BaseButton :disabled="signingOut" @click="signOut">Sign out</BaseButton>
      </div>
      <SyncSetupSection />
    </template>

    <template v-else-if="step === 'waiting'">
      <div class="ac-label">Check your email and open the link. Make sure the page shows this code:</div>
      <div class="ac-code">{{ code }}</div>
      <div class="ac-row">
        <HintText class="ac-meta">{{ notice || 'Waiting for you to approve…' }}</HintText>
        <BaseButton @click="cancel">Cancel</BaseButton>
      </div>
    </template>

    <template v-else-if="step !== 'loading'">
      <div class="ac-meta">
        <div class="ac-label">Sign in to OzenDB</div>
        <HintText class="ac-hint">We will email you a link to sign in. Signing in or out happens straight away, not on Save.</HintText>
      </div>
      <div class="ac-row">
        <BaseInput
          v-model="email"
          class="ac-email"
          type="email"
          placeholder="you@example.com"
          :disabled="step === 'sending'"
          @enter="email.trim() && start(email)"
        />
        <BaseButton variant="primary" :disabled="step === 'sending' || !email.trim()" @click="start(email)">Sign in</BaseButton>
      </div>
    </template>

    <FieldError :text="error" />
  </div>
</template>

<style scoped>
.ac-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ac-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ac-meta { flex: 1; min-width: 0; }
.ac-label { font-size: 13px; color: var(--text); }
.ac-hint { margin-top: 2px; }
.ac-email { flex: 1; min-width: 0; }
.ac-code {
  font-family: var(--mono);
  font-size: 24px;
  letter-spacing: 0.2em;
  color: var(--text);
}
</style>
