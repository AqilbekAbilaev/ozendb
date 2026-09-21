import { ref, computed } from 'vue'
import { canSelfUpdate } from '../appApi/updater'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { openUrl } from '@tauri-apps/plugin-opener'
import { openModal, closeModal } from './modals'
import { showToast } from './toast'
import { RELEASES_URL } from '../constants/helpLinks'

// The launch check is silent (nobody asked) and the menu check is loud (a menu item that
// does nothing reads as broken). A deb/rpm install can't replace itself and the updater
// only finds out mid-install, so `can_self_update` is asked first and the dialog offers
// the downloads page instead.

export const pending    = ref(null)
export const canInstall = ref(false)
export const checking   = ref(false)
export const installing = ref(false)
export const downloaded = ref(0)
export const total      = ref(0)

async function runCheck(silent) {
  if (checking.value || installing.value) return
  checking.value = true
  try {
    const update = await check()
    if (!update) {
      if (!silent) showToast('OzenDB is up to date')
      return
    }
    canInstall.value = await probeSelfUpdate()
    pending.value = update
    openModal('update', undefined, {
      props: dialogProps,
      on: { install, downloads: openDownloads },
    })
  } catch (e) {
    if (!silent) showToast('Could not check for updates')
  } finally {
    checking.value = false
  }
}

async function probeSelfUpdate() {
  try {
    return await canSelfUpdate()
  } catch (e) {
    return false
  }
}

export const checkOnLaunch = () => runCheck(true)
export const checkNow      = () => runCheck(false)

export async function install() {
  if (!pending.value || installing.value) return
  installing.value = true
  downloaded.value = 0
  total.value = 0
  try {
    await pending.value.downloadAndInstall(onProgress)
    // Relaunching is what applies the update; the old binary is already replaced.
    await relaunch()
  } catch (e) {
    showToast('Update failed to install')
  } finally {
    installing.value = false
  }
}

function onProgress(event) {
  if (event.event === 'Started') total.value = event.data?.contentLength || 0
  else if (event.event === 'Progress') downloaded.value += event.data?.chunkLength || 0
}

export function openDownloads() {
closeModal('update')
openUrl(RELEASES_URL).catch(() => showToast('Could not open link'))
}

// Everything UpdateModal renders stays with the state that feeds it.
export const dialogProps = computed(() => ({
  update: pending.value,
  canInstall: canInstall.value,
  installing: installing.value,
  downloaded: downloaded.value,
  total: total.value,
}))

// Module-scope state persists through HMR; tests use this to start each case clean.
export function resetUpdater() {
pending.value = null
canInstall.value = false
checking.value = false
installing.value = false
downloaded.value = 0
total.value = 0
}
