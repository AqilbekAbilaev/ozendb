import { watch } from 'vue'
import { parseField } from '../../../../utils/queryParser'

export function useInitialFindRun(activeWorkspace, { runQuery }) {
  watch(activeWorkspace, (workspace) => {
    if (workspace?.type !== 'mongodb.find' || !workspace.needsInitialRun) return

    workspace.needsInitialRun = false
    const filter = parseField(workspace.state.query.filter)
    const projection = parseField(workspace.state.query.projection)
    const sort = parseField(workspace.state.query.sort)
    runQuery(workspace, {
      filter: filter.ok ? filter.ejson : '{}',
      projection: projection.ok ? projection.ejson : '{}',
      sort: sort.ok ? sort.ejson : '{}',
      skip: Number(workspace.state.query.skip),
      limit: Number(workspace.state.query.limit),
    })
  }, { immediate: true })
}
