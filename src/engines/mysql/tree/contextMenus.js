import { CHOOSE_COLOR, COPY_NAME, DISCONNECT, REFRESH_NODE } from '../../../constants/contextMenus'

// The right-click menus for MySQL's sidebar rows, in the same shape as PostgreSQL's
// (postgresql/tree/contextMenus.js). Only the shared items, all handled by useFeatures:
// opening a table or a query tab comes with #388 and #389. A database or table row
// has no Choose Color yet, as the colour store keys rows by engine-specific menu type.
export const MYSQL_MENUS = {
  connection: [COPY_NAME, { sep: true }, REFRESH_NODE, CHOOSE_COLOR, { sep: true }, ...DISCONNECT],
  database: [COPY_NAME, { sep: true }, REFRESH_NODE],
  table: [COPY_NAME],
}
