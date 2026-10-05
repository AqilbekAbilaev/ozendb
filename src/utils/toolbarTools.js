// The toolbar for the engine in focus (#163), picked the way the native menu picks its
// items (#152): buttons with no `engine` (Connect) always show, an engine's own
// only while that engine is in focus. Dividers are re-tidied so a group left empty
// doesn't leave two in a row or one at either end.
export function toolbarTools(tools, engine) {
  const kept = []
  for (const tool of tools) {
    if (tool.sep) {
      if (kept.length && !kept[kept.length - 1].sep) kept.push(tool)
    } else if (!tool.engine || tool.engine === engine) {
      kept.push(tool)
    }
  }
  if (kept[kept.length - 1]?.sep) kept.pop()
  return kept
}
