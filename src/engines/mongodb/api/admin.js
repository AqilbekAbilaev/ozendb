// Mongo admin API: server/database/collection stats, current operations, the
// profiler, validators, users, roles, and server-side functions. Targets are
// collection-scoped where the command needs a collection, otherwise database-scoped;
// server-wide commands take a bare connection id.

import { invoke } from '@tauri-apps/api/core'
import { connectionPayload, databasePayload, collectionPayload } from './payload'

export function collectionStats(target) {
  return invoke('collection_stats', collectionPayload(target))
}

export function databaseStats(target) {
  return invoke('database_stats', databasePayload(target))
}

export function serverStatus(connectionId) {
  return invoke('server_status', connectionPayload(connectionId))
}

export function serverInfo(connectionId, kind) {
  return invoke('server_info', connectionPayload(connectionId, { kind }))
}

export function currentOps(connectionId, options = {}) {
  const extra = {}
  if (options.ownOnly !== undefined) extra.ownOnly = options.ownOnly
  if (options.all !== undefined) extra.all = options.all
  return invoke('current_ops', connectionPayload(connectionId, extra))
}

export function killOp(connectionId, opid) {
  return invoke('kill_op', connectionPayload(connectionId, { opid }))
}

export function getProfilingStatus(target) {
  return invoke('get_profiling_status', databasePayload(target))
}

export function setProfilingLevel(target, level, slowms) {
  return invoke('set_profiling_level', databasePayload(target, { level, slowms }))
}

export function listProfile(target, limit, slowerThanMs) {
  return invoke('list_profile', databasePayload(target, { limit, slowerThanMs }))
}

export function getValidator(target) {
  return invoke('get_validator', collectionPayload(target))
}

export function setValidator(target, validator, validationLevel, validationAction) {
  return invoke('set_validator', collectionPayload(target, { validator, validationLevel, validationAction }))
}

export function listUsers(target) {
  return invoke('list_users', databasePayload(target))
}

export function createUser(target, username, password, roles) {
  return invoke('create_user', databasePayload(target, { username, password, roles }))
}

export function dropUser(target, username) {
  return invoke('drop_user', databasePayload(target, { username }))
}

export function copyUsersToConnection(sourceTarget, targetId, targetDatabase) {
  return invoke('copy_users_to_connection', {
    sourceId:       sourceTarget.connectionId,
    sourceDatabase: sourceTarget.database,
    targetId,
    targetDatabase,
  })
}

export function listRoles(target) {
  return invoke('list_roles', databasePayload(target))
}

export function listFunctions(target) {
  return invoke('list_functions', databasePayload(target))
}

export function saveFunction(target, name, body) {
  return invoke('save_function', databasePayload(target, { name, body }))
}

export function dropFunction(target, name) {
  return invoke('drop_function', databasePayload(target, { name }))
}