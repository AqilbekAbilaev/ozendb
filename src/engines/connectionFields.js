// Each engine's payload builder. Kept apart from connectionEditor.js, which imports
// components, so the form composable can use it.
import { buildMongoFields } from './mongodb/connection/fields.js'
import { buildPostgresFields } from './postgresql/connection/fields.js'

export const BUILD_FIELDS = Object.freeze({
  mongodb: buildMongoFields,
  postgresql: buildPostgresFields,
})
