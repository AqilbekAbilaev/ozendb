import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listDatabases } from '../engines/mongodb/api/resources'
import { exportCollection, importCollection } from '../engines/mongodb/api/transfer'
import { errText } from '../utils/errors'

// Import / export flows. Per-collection export is a workspace tab (see openExportTab in
// App.vue); import opens a format picker first. The database-level Export/Import
// Collections… run the plain per-collection commands in a loop over a chosen folder/files.
// `showToast` and `connectionTreeRef` are injected; `openModal` is the registry opener
// from useModals, so the import format picker opens through the same path as every
// other registry-driven modal.
export function useDbTransfer({ showToast, connectionTreeRef, openModal }) {
  // Import starts with the format picker; on Configure it opens the matching import tab.
  function openImportWizard(nodeData) {
    openModal('import', {
      connId: nodeData.connId,
      connName: nodeData.connName,
      dbName: nodeData.dbName,
      collName: nodeData.collName,
    })
  }

  // After a wizard import, refresh the connection so a newly-populated collection shows
  // up in the sidebar.
  async function onWizardImported(connId) {
    await connectionTreeRef.value.refreshConn(connId)
  }

  // Database → Export Collections…: export every collection in the database to a chosen
  // folder, one JSON file per collection. Reuses the per-collection command.
  async function exportDatabase(nodeData) {
    let dir
    try {
      dir = await openDialog({ directory: true, title: `Export all collections in ${nodeData.dbName}` })
    } catch (e) {
      showToast('Export failed: ' + errText(e))
      return
    }
    if (!dir) return  // user cancelled
    let collections = []
    try {
      const dbs = await listDatabases(nodeData.connId)
      collections = (dbs.find(d => d.name === nodeData.dbName)?.collections) || []
    } catch (e) {
      showToast('Export failed: ' + errText(e))
      return
    }
    if (!collections.length) { showToast('No collections to export'); return }
    let done = 0
    let failed = 0
    for (const coll of collections) {
      try {
        await exportCollection(
          { connectionId: nodeData.connId, database: nodeData.dbName, collection: coll },
          `${dir}/${coll}.json`,
          'json',
        )
        done++
      } catch (_) {
        failed++
      }
    }
    showToast(`Exported ${done} collection${done !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}`)
  }

  // Database → Import Collections…: import one or more JSON/CSV files into the database,
  // each into a collection named after the file. Reuses the per-file command.
  async function importDatabase(nodeData) {
    let paths
    try {
      paths = await openDialog({
        multiple: true,
        filters: [{ name: 'JSON or CSV', extensions: ['json', 'csv'] }],
      })
    } catch (e) {
      showToast('Import failed: ' + errText(e))
      return
    }
    if (!paths || !paths.length) return  // user cancelled
    let done = 0
    let failed = 0
    for (const path of paths) {
      const p = String(path)
      const base = p.split(/[\\/]/).pop() || p
      const collection = base.replace(/\.(json|csv)$/i, '')
      const format = p.toLowerCase().endsWith('.csv') ? 'csv' : 'json'
      try {
        await importCollection(
          { connectionId: nodeData.connId, database: nodeData.dbName, collection },
          p,
          format,
        )
        done++
      } catch (_) {
        failed++
      }
    }
    await connectionTreeRef.value.refreshConn(nodeData.connId)
    showToast(`Imported ${done} file${done !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}`)
  }

  return {
    openImportWizard: openImportWizard,
    onWizardImported: onWizardImported,
    exportDatabase: exportDatabase,
    importDatabase: importDatabase,
  }
}
