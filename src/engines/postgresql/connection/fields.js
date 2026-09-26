// PostgreSQL's part of the connection editor's payload, from plain form values.
export function buildPostgresFields(v) {
  return {
    database: v.database.trim() || null,
    username: v.username || null,
    password: v.password || null,
  }
}
