function snapshotSource(source) {
  return {
    path: source.path,
    targetDb: source.targetDb,
    targetColl: source.targetColl,
  }
}

export function useImportPaneLifecycle() {
  let runVersion = 0
  let previewVersion = 0

  function attach() {
    runVersion++
    previewVersion++
  }

  function beginSource(tab) {
    return {
      tab,
      tabId: tab.id,
      format: tab.format,
      targetDb: tab.dbName,
      targetColl: tab.collName,
    }
  }

  function beginRun(tab) {
    return {
      version: ++runVersion,
      tabId: tab.id,
      connectionId: tab.connId,
      format: tab.format,
      validate: !!tab.validate,
      sources: tab.sources.map(snapshotSource),
    }
  }

  function isCurrentRun(run, tab) {
    return !!run && !!tab && run.version === runVersion && run.tabId === tab.id
  }

  function beginPreview(tab, source) {
    return {
      version: ++previewVersion,
      tabId: tab.id,
      path: source.path,
      format: tab.format,
    }
  }

  function isCurrentPreview(preview, tab) {
    return !!preview && !!tab
      && preview.version === previewVersion
      && preview.tabId === tab.id
  }

  function cancelPreview() {
    previewVersion++
  }

  return {
    attach,
    beginSource,
    beginRun,
    isCurrentRun,
    beginPreview,
    isCurrentPreview,
    cancelPreview,
  }
}
