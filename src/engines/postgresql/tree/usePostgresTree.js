import { ref } from 'vue'
import { listDatabases, listTables, listColumns, listForeignKeys } from '../api/resources'
import { errMessage } from '../../../utils/errors'

// PostgreSQL's own schemas (pg_catalog, information_schema, …) are in every database
// and aren't what anyone is usually browsing for — hidden unless asked for.
export function visibleSchemas(schemas, showSystem = false) {
  return showSystem ? schemas : schemas.filter(schema => !schema.system)
}

/**
 * One PostgreSQL connection's sidebar state below its schema list: whether its
 * database row is open, and each schema's tables, fetched the first time it opens.
 */
export function usePostgresTree(connectionId) {
  const databaseOpen = ref(false)
  const showSystem = ref(false)
  const openSchemas = ref({})   // schema → boolean
  const tables = ref({})        // schema → PgTableInfo[]
  const loading = ref({})       // schema → boolean
  const errors = ref({})        // schema (or table key) → message
  // A table's Columns folder: open state and columns, fetched the first time it opens.
  const openTables = ref({})    // table key → boolean
  const tableColumns = ref({})  // table key → column rows
  const tableKey = (schema, table) => JSON.stringify([schema, table])
  // The connection's own database size, read once. A failure leaves it null: a missing
  // size is worth less than the tree, and must never keep the tree from drawing.
  const databaseSizes = ref({})   // database name → bytes
  let sizesRead = false

  async function loadDatabaseSizes() {
    if (sizesRead) return
    sizesRead = true
    try {
      const databases = await listDatabases(connectionId)
      databaseSizes.value = Object.fromEntries(databases.map(d => [d.name, d.sizeBytes]))
    } catch {
      databaseSizes.value = {}
    }
  }

  function toggleSystem() {
    showSystem.value = !showSystem.value
  }

  function toggleDatabase() {
    databaseOpen.value = !databaseOpen.value
    if (databaseOpen.value) loadDatabaseSizes()
  }

  async function toggleSchema(schema) {
    openSchemas.value[schema] = !openSchemas.value[schema]
    if (!openSchemas.value[schema] || tables.value[schema]) return
    return loadTables(schema)
  }

  // After a refresh: the open schemas' tables are re-read, the closed ones' dropped
  // so they're fetched fresh when next opened. Columns are re-read on next open too.
  function reloadTables() {
    // A refresh re-reads the size too: rows have changed, so the number on the row has.
    sizesRead = false
    if (databaseOpen.value) loadDatabaseSizes()
    tables.value = {}
    tableColumns.value = {}
    openTables.value = {}
    const open = Object.keys(openSchemas.value).filter(schema => openSchemas.value[schema])
    return Promise.all(open.map(loadTables))
  }

  async function loadTables(schema) {
    loading.value[schema] = true
    delete errors.value[schema]
    try {
      tables.value[schema] = await listTables({ connectionId, schema })
    } catch (e) {
      errors.value[schema] = errMessage(e)
      openSchemas.value[schema] = false
    } finally {
      loading.value[schema] = false
    }
  }

  async function toggleTable(schema, table) {
    const key = tableKey(schema, table)
    openTables.value[key] = !openTables.value[key]
    if (!openTables.value[key] || tableColumns.value[key]) return
    delete errors.value[key]
    try {
      const target = { connectionId, schema, table }
      const [columns, keys] = await Promise.all([listColumns(target), listForeignKeys(target)])
      tableColumns.value[key] = columns.map(c => ({
        name: c.name,
        dataType: c.dataType,
        primaryKey: c.isPrimaryKey,
        references: referenceOf(keys, schema, table, c.name),
        nullable: c.nullable,
      }))
    } catch (e) {
      errors.value[key] = errMessage(e)
      openTables.value[key] = false
    }
  }
  const isTableOpen = (schema, table) => !!openTables.value[tableKey(schema, table)]
  const columnsOf = (schema, table) => tableColumns.value[tableKey(schema, table)] ?? null

  return { toggleTable, isTableOpen, columnsOf, databaseSizes, databaseOpen, toggleDatabase, showSystem, toggleSystem, openSchemas, tables, loading, errors, toggleSchema, reloadTables }
}

// Whether `tab` (the active one) is browsing this table — the row the tree highlights.
export function isOpenTable(tab, connectionId, schema, table) {
  return tab?.type === 'postgresql.table_browse' && tab.connectionId === connectionId && tab.schema === schema && tab.table === table
}

// `table.column` a column's foreign key points at (schema-qualified when it's in
// another schema), or null.
function referenceOf(keys, schema, table, column) {
  const fk = keys.find(k => k.fromSchema === schema && k.fromTable === table && k.fromColumns.includes(column))
  if (!fk) return null
  return `${fk.toSchema === schema ? '' : fk.toSchema + '.'}${fk.toTable}.${fk.toColumns[fk.fromColumns.indexOf(column)]}`
}
