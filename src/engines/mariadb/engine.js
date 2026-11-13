// MariaDB's entry in the engine table (engines/index.js). It shares MySQL's fields,
// resources and SQL: MariaDB speaks MySQL's protocol, and the backend adapts to
// whichever server it finds, so only the id differs.
import { mysql } from '../mysql/engine.js'

export const mariadb = Object.freeze({ ...mysql, id: 'mariadb' })
