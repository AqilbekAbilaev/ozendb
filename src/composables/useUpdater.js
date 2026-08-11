import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// Self-update, end to end: the check, the pending update, download progress, the install
// and the fallback for installs that can't replace themselves.
//
// Two kinds of check share one path. The launch check is silent — a user who opened the
// app to look at a database did not ask about updates, so a failed or empty check says
// nothing. The menu check is loud, because a menu item that appears to do nothing reads
// as broken.
//
// `can_self_update` decides what the dialog offers. A deb/rpm install is owned by the
// package manager and the Tauri updater cannot replace it; it only discovers that at
// install time, after the user has already agreed. So we ask first, and fail towards the
// downloads page — a Mac user sent to a working download page is a smaller failure than
// anyone promised an install that can't happen.
export function useUpdater({ showToast, openModal, closeModal, openDownloadsPage }) {
  const pending    = ref(null)   // the plugin's Update object, or null
  const canInstall = ref(false)
  const checking   = ref(false)
  const installing = ref(false)
  const downloaded = ref(0)
  const total      = ref(0)

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
      openModal('update')
    } catch (e) {
      if (!silent) showToast('Could not check for updates')
    } finally {
      checking.value = false
    }
  }

  async function probeSelfUpdate() {
    try {
      return await invoke('can_self_update')
    } catch (e) {
      return false
    }
  }

  const checkOnLaunch = () => runCheck(true)
  const checkNow      = () => runCheck(false)

  async function install() {
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

  function openDownloads() {
    closeModal('update')
    openDownloadsPage()
  }

  // Everything UpdateModal renders, in one place — the dialog's prop shape belongs with
  // the state that feeds it, not spread across App.vue's modalProps map.
  const dialogProps = computed(() => ({
    update: pending.value,
    canInstall: canInstall.value,
    installing: installing.value,
    downloaded: downloaded.value,
    total: total.value,
  }))

  return {
    pending, canInstall, checking, installing, downloaded, total, dialogProps,
    checkOnLaunch, checkNow, install, openDownloads,
  }
}
