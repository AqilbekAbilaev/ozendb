// A SQL engine's part of the connection editor's payload, from plain form values.
export function buildSqlFields(v) {
  return {
    database: v.database.trim() || null,
    username: v.username || null,
    password: v.password || null,
  }
}
