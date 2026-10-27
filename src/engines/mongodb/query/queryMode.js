export function setCollectionQueryMode(workspace, mode) {
  if (mode !== 'find' && mode !== 'aggregate') return
  workspace.mode = mode
  workspace.type = mode === 'aggregate' ? 'mongodb.aggregate' : 'mongodb.find'
}
