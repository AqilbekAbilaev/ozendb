import { showToast } from '../../../stores/toast'
import {
  openCollectionTab, openShellTab, openIndexManagerTab, openSchemaTab,
  openSearchTab, openCurrentOpsTab, openExportSource,
} from '../tabs'
import { useDbActions } from './useDbActions'
import { useDbTransfer } from './useDbTransfer'
import { dbClipboard } from '../../../stores/dbClipboard'
import { MODALS } from '../../../constants/modalRegistry'
import { resourceAt, resourceName } from '../../../utils/resourceRef'
import { openModal } from '../../../stores/modals'

// The node's resource cut to `level` — a database action run on a collection row acts
// on that row's database — with the connection's display name beside it, since a ref
// never carries one. This is what every tab, modal and wizard takes; they read the
// names they show off the ref.
export function targetAt(ref, ctx, level) {
  return { resource: resourceAt(ref, level), connectionName: ctx.connectionName }
}

// Add View is the one structural dialog whose payload isn't just the node's level fields:
// it carries the source collection to prefill (empty from a database node, the clicked
// collection from "Add View Here…"), so it opens directly instead of via modalFeature.
function openAddView(ref, ctx, source) {
  openModal('addView', { ...targetAt(ref, ctx, 'database'), source: source })
}

// A registry-driven modal feature (see constants/modalRegistry.js): its level and
// component are declared once in MODALS, so the feature is named by id alone and opens
// the registry modal with the target that level needs. Every registry modal now takes a
// ResourceRef, whatever its level (#193).
function modalFeature(id) {
  const level = MODALS[id].level
  return { requires: level, run: (ref, ctx) => openModal(id, targetAt(ref, ctx, level)) }
}

function openServerInfo(ref, ctx, kind, title) {
  openModal('serverInfo', {
    ...targetAt(ref, ctx, 'connection'), kind: kind, title: title,
  })
}
function copyToClipboard(ref, ctx, kind) {
  const copied = targetAt(ref, ctx, kind)
  dbClipboard.value = { kind: kind, ...copied }
  showToast(`Copied ${kind} "${resourceName(copied.resource)}"`)
}

// MongoDB's right-click and native-menu actions, in the shape the shared dispatcher
// (composables/useFeatures) runs: the node level each needs, and a handler taking the
// node's ResourceRef and its presentation `ctx` (connectionName, label). Keyed by action
// id; the labels menus show are theirs, not ours. Ids match the native menu's where it
// offers the same action.
export function useMongoActions() {
  const { pasteClipboard } = useDbActions()
  const { openImportWizard, exportDatabase, importDatabase } = useDbTransfer()

  return {
    // ── open a tab ──
    'coll:open_tab':           { requires: 'collection', run: (r, c) => openCollectionTab(targetAt(r, c, 'collection')) },
    'coll:aggregation':        { requires: 'collection', run: (r, c) => openCollectionTab(targetAt(r, c, 'collection'), 'aggregate') },
    'file:intellishell':       { requires: 'database',   run: (r, c) => openShellTab(targetAt(r, c, 'database')) },
    'coll:add_index':          { requires: 'collection', run: (r, c) => openIndexManagerTab(targetAt(r, c, 'collection')) },

    // ── connection-scoped info modals ──
    'file:server_status':      modalFeature('serverStatus'),
    'file:server_charts':      modalFeature('serverCharts'),
    'db:current_ops':          { requires: 'connection', run: (r, c) => openCurrentOpsTab(targetAt(r, c, 'connection')) },
    'file:server_build':       { requires: 'connection', run: (r, c) => openServerInfo(r, c, 'build',   'Build Info') },
    'conn:host_info':          { requires: 'connection', run: (r, c) => openServerInfo(r, c, 'host',    'Host Info') },
    'conn:replica_status':     { requires: 'connection', run: (r, c) => openServerInfo(r, c, 'replica', 'Replica Set Status') },

    // ── database-scoped modals ──
    'db:database_stats':       modalFeature('dbStats'),
    'db:profiler':             modalFeature('profiler'),
    'db:manage_users':         modalFeature('users'),
    'db:manage_roles':         modalFeature('roles'),
    'db:functions':            modalFeature('functions'),
    'gridfs:open':             modalFeature('gridfs'),
    'file:search':             { requires: 'database', run: (r, c) => openSearchTab(targetAt(r, c, 'database')) },

    // ── collection-scoped modals ──
    'coll:validator':          modalFeature('validator'),
    'coll:schema':             { requires: 'collection', run: (r, c) => openSchemaTab(targetAt(r, c, 'collection')) },
    'coll:history':            modalFeature('history'),
    'coll:stats':              modalFeature('stats'),
    'coll:mapreduce':          modalFeature('mapReduce'),

    // ── create/edit dialogs (each owns its form state; see constants/modalRegistry.js) ──
    'db:add_collection':       modalFeature('addCollection'),
    'db:add_database':         modalFeature('addDatabase'),
    'db:add_view':             { requires: 'database',   run: (r, c) => openAddView(r, c, '') },
    'coll:add_view':           { requires: 'collection', run: (r, c) => openAddView(r, c, resourceName(r)) },
    'db:add_bucket':           modalFeature('addBucket'),
    'db:drop_database':        modalFeature('dropDatabase'),
    'coll:drop':               modalFeature('dropCollection'),
    'coll:rename':             modalFeature('renameCollection'),
    'coll:duplicate':          modalFeature('duplicateCollection'),

    // ── import / export (collection-level wizards; db-level exports many) ──
    'coll:export':             { requires: 'collection', run: (r, c) => openExportSource(targetAt(r, c, 'collection')) },
    'coll:import':             { requires: 'collection', run: (r, c) => openImportWizard(targetAt(r, c, 'collection')) },
    // Export / Import Collections… act on a database, so a collection row resolves to
    // its database rather than carrying a collection the handlers would ignore.
    'db:export':               { requires: 'database',   run: (r, c) => exportDatabase(targetAt(r, c, 'database')) },
    'db:import':               { requires: 'database',   run: (r, c) => importDatabase(targetAt(r, c, 'database')) },

    // ── clipboard / copy-paste ──
    'coll:copy':               { requires: 'collection', run: (r, c) => copyToClipboard(r, c, 'collection') },
    'db:copy_database':        { requires: 'database',   run: (r, c) => copyToClipboard(r, c, 'database') },
    'db:paste':                { requires: 'database',   run: (r, c) => pasteClipboard(targetAt(r, c, 'database')) },
  }
}
