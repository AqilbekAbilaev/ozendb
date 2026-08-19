import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every MongoDB-specific Tauri command, grouped by the API module that owns it.
// This list is the single source of truth for the boundary: a command named here
// may only be invoked from inside src/engines/mongodb/api/.
const MONGO_COMMANDS = [
  // queries.js
  'find_documents', 'run_aggregate', 'kill_query', 'count_documents',
  'search_collections', 'map_reduce', 'translate_sql', 'explain_query',
  'explain_aggregate',
  // queryLibrary.js
  'get_default_query', 'set_default_query', 'clear_default_query',
  'list_saved_queries', 'save_query', 'delete_saved_query',
  'get_query_history', 'push_query_history', 'clear_query_history',
  // connections.js
  'test_connection', 'test_ssh_connection', 'save_connection',
  'update_connection', 'list_connections', 'delete_connection',
  'disconnect', 'connection_uri', 'duplicate_connection',
  'export_connections', 'import_connections',
  // resources.js
  'list_databases', 'create_collection', 'create_database', 'create_view',
  'drop_database', 'drop_collection', 'rename_collection',
  // documents.js
  'insert_document', 'insert_documents', 'replace_document', 'delete_document',
  'update_many', 'delete_many', 'clear_collection',
  'list_collection_history', 'clear_collection_history', 'restore_history',
  'open_document_window',
  // indexes.js
  'list_indexes', 'create_index', 'drop_index', 'set_index_hidden', 'index_stats',
  // admin.js
  'collection_stats', 'database_stats', 'server_status', 'server_info',
  'current_ops', 'kill_op', 'get_profiling_status', 'set_profiling_level',
  'list_profile', 'get_validator', 'set_validator',
  'list_users', 'create_user', 'drop_user', 'copy_users_to_connection',
  'list_roles', 'list_functions', 'save_function', 'drop_function',
  // schema.js
  'analyze_schema', 'export_schema',
  // transfer.js
  'export_collection', 'import_collection', 'import_collection_mapped',
  'export_collection_fields', 'import_preview', 'duplicate_collection',
  'copy_collection', 'copy_collection_to_connection',
  // gridfs.js
  'list_gridfs_buckets', 'list_gridfs_files', 'gridfs_upload', 'gridfs_download',
  'gridfs_delete', 'gridfs_rename', 'gridfs_set_metadata',
  'gridfs_drop_bucket', 'gridfs_copy_bucket',
  // shell.js
  'run_shell_command', 'close_shell_session', 'get_shell_history',
  'push_shell_command', 'clear_shell_history',
]

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!full.includes('engines/mongodb/api')) walk(full, files)
    } else if (full.endsWith('.js') || full.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

describe('Mongo API boundary', () => {
  it('never invokes a MongoDB command outside src/engines/mongodb/api/', () => {
    const offenders = []
    for (const file of walk(join(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8')
      for (const command of MONGO_COMMANDS) {
        if (source.includes(`invoke('${command}'`)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}: invoke('${command}')`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})