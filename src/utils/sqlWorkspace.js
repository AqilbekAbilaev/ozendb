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

  tab.filter = mql.filter
  tab.projection = mql.projection
  tab.sort = mql.sort
  tab.skip = mql.skip ?? 0
  tab.limit = mql.limit ?? (tab.limit || 50)
  runQuery(tab, {
    filter: mql.filter,
    projection: mql.projection,
    sort: mql.sort,
    skip: tab.skip,
    limit: tab.limit,
    addToHistory: true,
  })
  if (explainVisible()) runExplain(tab)
}
