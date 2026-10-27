// Each engine's rows in the modal registry, which constants/modalRegistry.js merges with
// the app's own. The SQL engines' shared dialogs are a table of their own. Kept apart
// from engines/ui.js, which loads components, because composables read the registry:
// every row here loads its dialog lazily.
import { MONGO_MODALS } from './mongodb/modals.js'
import { PG_MODALS } from './postgresql/modals.js'
import { MYSQL_MODALS } from './mysql/modals.js'
import { SQL_MODALS } from './sql/modals.js'

export const ENGINE_MODALS = Object.freeze([MONGO_MODALS, SQL_MODALS, PG_MODALS, MYSQL_MODALS])
