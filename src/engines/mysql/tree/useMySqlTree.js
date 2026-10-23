import { ref } from 'vue'
import { listTables, listColumns } from '../api/resources'
import { errMessage } from '../../../utils/errors'

// MySQL's own databases (mysql, sys, …) are on every server and aren't what anyone is
// usually browsing for — hidden unless asked for, as PostgreSQL's own schemas are.
export function visibleDatabases(databases, showSystem) {
  return showSystem ? databases : databases.filter(database => !database.system)
}

// A column as its sidebar row shows it. A foreign key names the column it points at by
// its table, and by its database too when that is another one.
export function columnRow(column, database) {
  const to = column.references
  return {
    name: column.name,
    dataType: column.dataType,
    primaryKey: column.isPrimaryKey,
    references: to && `${to.database === database ? '' : to.database + '.'}${to.table}.${to.column}`,
    nullable: column.nullable,
  }
}

/**
 * One MySQL connection's sidebar state below its database list: each database's tables
 * and each table's columns, fetched the first time they open.
 */
export function useMySqlTree(connectionId) {
  const showSystem = ref(false)
  const openDatabases = ref({})  // database → boolean
  const tables = ref({})         // database → MySqlTableInfo[]
  const loading = ref({})        // database → boolean
  const errors = ref({})         // database (or table key) → message
  const openTables = ref({})     // table key → boolean
  const tableColumns = ref({})   // table key → column rows
  const tableKey = (database, table) => JSON.stringify([database, table])

  function toggleSystem() {
    showSystem.value = !showSystem.value
  }

  async function toggleDatabase(database) {
    openDatabases.value[database] = !openDatabases.value[database]
    if (!openDatabases.value[database] || tables.value[database]) return
    return loadTables(database)
  }

  // After a refresh: the open databases' tables are re-read, the closed ones' dropped
  // so they're fetched fresh when next opened. Columns are re-read on next open too, and
  // every error is forgotten with what it was about.
  function reloadTables() {
    tables.value = {}
    errors.value = {}
    tableColumns.value = {}
    openTables.value = {}
    const open = Object.keys(openDatabases.value).filter(database => openDatabases.value[database])
    return Promise.all(open.map(loadTables))
  }

  async function loadTables(database) {
    loading.value[database] = true
    delete errors.value[database]
    try {
      tables.value[database] = await listTables({ connectionId, database })
    } catch (e) {
      errors.value[database] = errMessage(e)
      openDatabases.value[database] = false
    } finally {
      loading.value[database] = false
    }
  }

  async function toggleTable(database, table) {
    const key = tableKey(database, table)
    openTables.value[key] = !openTables.value[key]
    if (!openTables.value[key] || tableColumns.value[key]) return
    delete errors.value[key]
    try {
      const columns = await listColumns({ connectionId, database, table })
      tableColumns.value[key] = columns.map(column => columnRow(column, database))
    } catch (e) {
      errors.value[key] = errMessage(e)
      openTables.value[key] = false
    }
  }
  const isTableOpen = (database, table) => !!openTables.value[tableKey(database, table)]
  const columnsOf = (database, table) => tableColumns.value[tableKey(database, table)] ?? null
  const tableError = (database, table) => errors.value[tableKey(database, table)] ?? null

  return { showSystem, toggleSystem, openDatabases, tables, loading, errors, toggleDatabase, reloadTables, toggleTable, isTableOpen, columnsOf, tableError }
}
