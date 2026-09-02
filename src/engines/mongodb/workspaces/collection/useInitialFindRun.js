import { watch } from 'vue'
import { parseField } from '../../../../utils/queryParser'

export function useInitialFindRun(activeWorkspace, { runQuery }) {
  watch(activeWorkspace, (workspace) => {
    if (workspace?.type !== 'mongodb.find' || !workspace.needsInitialRun) return

    workspace.needsInitialRun = false
    const filter = parseField(workspace.filter)
    const projection = parseField(workspace.projection)
    const sort = parseField(workspace.sort)
    runQuery(workspace, {
      filter: filter.ok ? filter.ejson : '{}',
      projection: projection.ok ? projection.ejson : '{}',
      sort: sort.ok ? sort.ejson : '{}',
      skip: Number(workspace.skip),
      limit: Number(workspace.limit),
    })
  }, { immediate: true })
}
