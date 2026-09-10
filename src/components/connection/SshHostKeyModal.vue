<script setup>
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import HintText from '../base/HintText.vue'

// Driven entirely by App.vue: `prompt` is set for a first-contact trust request,
// `changed` for a refused connection whose host key no longer matches. At most
// one is non-null at a time; `prompt` wins if both somehow are.
defineProps({
  prompt:  { type: Object, default: null },  // { requestId, host, port, fingerprint }
  changed: { type: Object, default: null },  // { host, port, storedFingerprint, presentedFingerprint }
})
defineEmits(['trust', 'cancel', 'forget', 'dismiss'])
</script>

<template>
  <!-- First-contact: ask the user to verify + trust the fingerprint. Backdrop /
       close act as Cancel so the waiting handshake always gets a decision. -->
  <BaseModal v-if="prompt" title="Unknown SSH Host" width="520px" max-width="92vw" @close="$emit('cancel')">
      <div class="hk-body">
        <div class="hk-lead">
          <span class="hk-ico"><BaseIcon name="lock" :size="22" /></span>
          <div>
            Connecting to <b>{{ prompt.host }}:{{ prompt.port }}</b> for the first time.
            The server presented this host key fingerprint:
          </div>
        </div>
        <div class="hk-fp">{{ prompt.fingerprint }}</div>
        <HintText dim>
          Only trust this host if the fingerprint matches the one your server
          administrator gave you. The key is saved and checked on every future
          connection.
        </HintText>
      </div>

      <div class="hk-footer">
        <span class="spacer"></span>
        <BaseButton @click="$emit('cancel')">Cancel</BaseButton>
        <BaseButton variant="primary" @click="$emit('trust')">Trust this host</BaseButton>
      </div>
  </BaseModal>

  <!-- Key changed: the connection was already refused; explain and offer the
       deliberate recovery path (forget the saved key, then reconnect). -->
  <BaseModal v-else-if="changed" width="520px" max-width="92vw" @close="$emit('dismiss')">
      <template #title><span class="danger">SSH Host Key Changed</span></template>
      <div class="hk-body">
        <div class="hk-lead">
          <span class="hk-ico danger"><BaseIcon name="lock" :size="22" /></span>
          <div class="danger">
            <b>Warning:</b> the host key for <b>{{ changed.host }}:{{ changed.port }}</b>
            does not match the key previously trusted. This can mean a
            man-in-the-middle attack — or that the server's key was legitimately
            rotated. The connection was <b>refused</b>.
          </div>
        </div>
        <div class="hk-fp-row"><span class="hk-fp-label">Previously trusted</span>
          <div class="hk-fp">{{ changed.storedFingerprint }}</div></div>
        <div class="hk-fp-row"><span class="hk-fp-label">Now presented</span>
          <div class="hk-fp">{{ changed.presentedFingerprint }}</div></div>
        <HintText dim>
          If you are certain the key changed for a legitimate reason, forget the
          saved key — the next connection will ask you to verify and trust the
          new one.
        </HintText>
      </div>

      <div class="hk-footer">
        <span class="spacer"></span>
        <BaseButton @click="$emit('dismiss')">Dismiss</BaseButton>
        <BaseButton variant="danger" @click="$emit('forget')">Forget saved key</BaseButton>
      </div>
  </BaseModal>
</template>

<style scoped>
.hk-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}

.hk-lead {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.hk-ico { color: var(--text-dim); flex: none; margin-top: 1px; }
.hk-ico.danger { color: var(--danger-text); }
.danger { color: var(--danger-text); }

.hk-fp {
  font-family: var(--mono);
  font-size: 12.5px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px 10px;
  color: var(--text);
  user-select: text;
  word-break: break-all;
}

.hk-fp-row { display: flex; flex-direction: column; gap: 4px; }
.hk-fp-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }


.hk-footer {
  height: 48px;
  flex: none;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
}
.spacer { flex: 1; }

</style>
