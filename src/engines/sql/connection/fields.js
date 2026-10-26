// A SQL engine's part of the connection editor's payload, from the form's shared values
// and the engine's own fields (useSqlFields).
export function buildSqlFields(v, sql) {
  return {
    database: sql.database.value.trim() || null,
    username: v.username || null,
    password: v.password || null,
  }
}
