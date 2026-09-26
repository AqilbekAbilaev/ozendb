import { ref } from 'vue'
import { listTables } from '../api/resources'
import { errMessage } from '../../../utils/errors'

// PostgreSQL's own schemas (pg_catalog, information_schema, …) are in every database
// and aren't what anyone is browsing for.
export function visibleSchemas(schemas) {
  return schemas.filter(schema => !schema.system)
}

/**
 * One PostgreSQL connection's sidebar state below its schema list: whether its
 * database row is open, and each schema's tables, fetched the first time it opens.
 */
export function usePostgresTree(connectionId) {
  const databaseOpen = ref(false)
  const openSchemas = ref({})   // schema → boolean
  const tables = ref({})        // schema → PgTableInfo[]
  const loading = ref({})       // schema → boolean
  const errors = ref({})        // schema → message

  function toggleDatabase() {
    databaseOpen.value = !databaseOpen.value
  }

  async function toggleSchema(schema) {
    openSchemas.value[schema] = !openSchemas.value[schema]
    if (!openSchemas.value[schema] || tables.value[schema]) return

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

  return { databaseOpen, toggleDatabase, openSchemas, tables, loading, errors, toggleSchema }
}
