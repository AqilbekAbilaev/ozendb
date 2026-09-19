import { ref, onMounted, onUnmounted } from 'vue'
import { respondSshHostKey, forgetSshHost } from '../appApi/sshTrust'
import { listen } from '@tauri-apps/api/event'

// SSH host-key prompts raised by the backend during a tunnel handshake and the
// handlers that respond to them.
export function useSshHostKey() {
  // SSH host-key prompts raised by the backend during a tunnel handshake. At most
  // one of each is active at a time; the modal shows the prompt first.
  const sshHostKeyPrompt = ref(null)   // { requestId, host, port, fingerprint }
  const sshHostKeyChanged = ref(null)  // { host, port, storedFingerprint, presentedFingerprint }

  let unlisten = []

  onMounted(() => {
    // Backend-raised SSH host-key prompts (global emits, so use the app-wide listen).
    unlisten = [
      listen('ssh-host-key-prompt', (e) => { sshHostKeyPrompt.value = e.payload }),
      listen('ssh-host-key-changed', (e) => { sshHostKeyChanged.value = e.payload }),
    ]
  })

  onUnmounted(() => unlisten.forEach(p => p.then(off => off())))

  function onHostKeyTrust() {
    if (sshHostKeyPrompt.value) {
      respondSshHostKey(sshHostKeyPrompt.value.requestId, true)
      sshHostKeyPrompt.value = null
    }
  }
  function onHostKeyCancel() {
    if (sshHostKeyPrompt.value) {
      respondSshHostKey(sshHostKeyPrompt.value.requestId, false)
      sshHostKeyPrompt.value = null
    }
  }
  async function onHostKeyForget() {
    if (sshHostKeyChanged.value) {
      await forgetSshHost(sshHostKeyChanged.value.host, sshHostKeyChanged.value.port)
      sshHostKeyChanged.value = null
    }
  }

  return {
    sshHostKeyPrompt: sshHostKeyPrompt,
    sshHostKeyChanged: sshHostKeyChanged,
    onHostKeyTrust: onHostKeyTrust,
    onHostKeyCancel: onHostKeyCancel,
    onHostKeyForget: onHostKeyForget,
  }
}
