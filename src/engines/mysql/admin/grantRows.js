// What the MySQL Grants modal sends. The privilege lists mirror the ones in
// src-tauri/src/commands/mysql/grants.rs, which refuses anything else.

export const GRANT_LEVELS = ['server', 'database', 'table']

// Each level's own privileges; a level takes the ones below it too.
const OWN = {
  table: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'REFERENCES', 'INDEX', 'ALTER', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER'],
  database: ['CREATE TEMPORARY TABLES', 'LOCK TABLES', 'EXECUTE', 'CREATE ROUTINE', 'ALTER ROUTINE', 'EVENT'],
  server: [
    'PROCESS', 'RELOAD', 'SHOW DATABASES', 'REPLICATION CLIENT', 'REPLICATION SLAVE', 'CREATE USER', 'CREATE ROLE', 'DROP ROLE',
    'FILE', 'SHUTDOWN', 'CREATE TABLESPACE',
  ],
}

export function privilegesFor(level) {
  return GRANT_LEVELS.slice(GRANT_LEVELS.indexOf(level)).reverse().flatMap(l => OWN[l])
}

// The form's draft as a change for `account`, or the first thing it still needs.
export function privilegeChange(account, draft) {
  const database = draft.level === 'server' ? null : draft.database.trim()
  const table = draft.level === 'table' ? draft.table.trim() : null
  const privileges = privilegesFor(draft.level).filter(p => draft.privileges.includes(p))
  if (database === '') return { error: 'Enter a database.' }
  if (table === '') return { error: 'Enter the table name.' }
  if (!privileges.length) return { error: 'Choose at least one privilege.' }
  return { change: { user: account.user, host: account.host, database, table, privileges, grantOption: !!draft.grantOption } }
}
