import { CHOOSE_COLOR, COPY_NAME, DISCONNECT, REFRESH_NODE } from '../../../constants/contextMenus'

// The right-click menu for a MySQL connection, in the same shape as PostgreSQL's
// (postgresql/tree/contextMenus.js). Only the shared items, all handled by useFeatures:
// MySQL has no actions of its own until a connection can connect (#386).
export const MYSQL_MENUS = {
  connection: [COPY_NAME, { sep: true }, REFRESH_NODE, CHOOSE_COLOR, { sep: true }, ...DISCONNECT],
}
