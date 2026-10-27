const requestVersions = new WeakMap()

export function beginWorkspaceRequest(workspace, channel) {
  const versions = requestVersions.get(workspace) || {}
  const version = (versions[channel] || 0) + 1
  versions[channel] = version
  requestVersions.set(workspace, versions)
  return {
    isCurrent: () => requestVersions.get(workspace)?.[channel] === version,
  }
}
