import { ref } from 'vue'
import { listTables, listColumns, listStoredPrograms } from '../api/resources'
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

// The folders that follow a database's tables, each with its rows as `{ name, meta }` and
// the right-click menu they share: its views, then each kind of stored program. A folder
// with nothing in it is left out.
export function programFolders(tables, programs) {
  const routines = (kind) => programs.routines.filter(routine => routine.kind === kind)
  const folders = [
    { kind: 'view', label: 'Views', icon: 'table', menu: 'view', rows: tables.filter(table => table.kind === 'view').map(view => ({ name: view.name, meta: null })) },
    { kind: 'procedure', menu: 'program', label: 'Procedures', icon: 'run', rows: routines('procedure').map(routine => ({ name: routine.name, meta: null })) },
    { kind: 'function', menu: 'program', label: 'Functions', icon: 'aggregate', rows: routines('function').map(routine => ({ name: routine.name, meta: `→ ${routine.returns}` })) },
    { kind: 'trigger', menu: 'program', label: 'Triggers', icon: 'bolt', rows: programs.triggers.map(trigger => ({ name: trigger.name, meta: `${trigger.timing} ${trigger.event} on ${trigger.table}` })) },
    { kind: 'event', menu: 'program', label: 'Events', icon: 'clock', rows: programs.events.map(event => ({ name: event.name, meta: `${event.schedule} · ${event.status.toLowerCase()}` })) },
  ]
  return folders.filter(folder => folder.rows.length)
}

const NO_PROGRAMS = { routines: [], triggers: [], events: [] }

/**
 * One MySQL connection's sidebar state below its database list: each database's tables
 * and stored programs, and each table's columns, fetched the first time they open.
 */
export function useMySqlTree(connectionId) {
  const showSystem = ref(false)
  const openDatabases = ref({})  // database → boolean
  const tables = ref({})         // database → MySqlTableInfo[], views included
  const programs = ref({})       // database → { routines, triggers, events }
  const programErrors = ref({})  // database → why its stored programs couldn't be read
  const openFolders = ref({})    // folder key → boolean
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
    programs.value = {}
    errors.value = {}
    programErrors.value = {}
    tableColumns.value = {}
    openTables.value = {}
    const open = Object.keys(openDatabases.value).filter(database => openDatabases.value[database])
    return Promise.all(open.map(loadTables))
  }

  // Its tables and its stored programs are read side by side, and either may fail alone:
  // a login that can't read the stored programs still sees the tables.
  async function loadTables(database) {
    loading.value[database] = true
    delete errors.value[database]
    delete programErrors.value[database]
    const [listed, stored] = await Promise.allSettled([listTables({ connectionId, database }), listStoredPrograms({ connectionId, database })])
    if (listed.status === 'fulfilled') tables.value[database] = listed.value
    else {
      errors.value[database] = errMessage(listed.reason)
      openDatabases.value[database] = false
    }
    if (stored.status === 'fulfilled') programs.value[database] = stored.value
    else programErrors.value[database] = errMessage(stored.reason)
    loading.value[database] = false
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

  const tablesOf = (database) => tables.value[database]?.filter(table => table.kind === 'table') ?? []
  const foldersOf = (database) => tables.value[database] ? programFolders(tables.value[database], programs.value[database] ?? NO_PROGRAMS) : []
  const programsError = (database) => programErrors.value[database] ?? null
  const folderKey = (database, kind) => JSON.stringify([database, kind])
  function toggleFolder(database, kind) {
    openFolders.value[folderKey(database, kind)] = !openFolders.value[folderKey(database, kind)]
  }
  const isFolderOpen = (database, kind) => !!openFolders.value[folderKey(database, kind)]

  return {
    showSystem, toggleSystem, openDatabases, tables, loading, errors, toggleDatabase, reloadTables, toggleTable, isTableOpen, columnsOf, tableError,
    tablesOf, foldersOf, programsError, toggleFolder, isFolderOpen,
  }
}
