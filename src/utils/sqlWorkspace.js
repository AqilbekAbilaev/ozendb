import { errText } from './errors'
import { beginWorkspaceRequest } from './workspaceRequest'

export async function runTranslatedSql(tab, {
  translate,
  runQuery,
  runExplain,
  explainVisible,
  isCurrent = () => true,
}) {
  const request = beginWorkspaceRequest(tab, 'sql-translation')
  const canApply = () => request.isCurrent() && isCurrent(tab)
  tab.sqlError = null
  let mql
  try {
    mql = await translate(tab.sql || '')
  } catch (e) {
    if (canApply()) tab.sqlError = errText(e)
    return
  }
  if (!canApply()) return

  tab.state.query.filter = mql.filter
  tab.state.query.projection = mql.projection
  tab.state.query.sort = mql.sort
  tab.state.query.skip = mql.skip ?? 0
  tab.state.query.limit = mql.limit ?? (tab.state.query.limit || 50)
  runQuery(tab, {
    filter: mql.filter,
    projection: mql.projection,
    sort: mql.sort,
    skip: tab.state.query.skip,
    limit: tab.state.query.limit,
    addToHistory: true,
  })
  if (explainVisible()) runExplain(tab)
}
