<script setup>
import { computed, watch } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import { useMySqlTree, visibleDatabases } from './useMySqlTree.js'
import { contextMenu } from '../../../stores/contextMenu'
import { activeTab } from '../../../stores/tabs'
import { openMySqlTable } from '../../../stores/tabCreators'
import { treeSelection, setTreeSelection } from '../../../stores/connectionNavigation'
import { MYSQL_MENUS } from './contextMenus.js'
import { tagOverrides } from '../../../stores/nodeTags'
import { colorHex, nodeTagName } from '../../../utils/tabColor.js'
import { createResourceRef, sameResource } from '../../../utils/resourceRef'
import { formatCompact } from '../../../utils/format'

// ConnectionTree hands every engine's rows its stats card; MySQL has none yet.
defineOptions({ inheritAttrs: false })

const props = defineProps({
  conn: { type: Object, required: true },
  resources: { type: Array, required: true },
})

const { showSystem, toggleSystem, openDatabases, tables, loading, errors, toggleDatabase, reloadTables, toggleTable, isTableOpen, columnsOf, tableError } =
  useMySqlTree(props.conn.id)
// A refresh brings a new database list; the open databases' tables are re-read with it.
watch(() => props.resources, reloadTables)
const shown = computed(() => visibleDatabases(props.resources, showSystem.value))
const systemCount = computed(() => props.resources.filter(database => database.system).length)

// Rows can't be coloured on their own yet (see contextMenus.js), so each shows its
// connection's colour, as MongoDB's uncoloured rows do.
const rowTag = computed(() => {
  const color = nodeTagName(tagOverrides.value, props.conn.id, props.conn.tag)
  return color ? { class: 'tagged', style: { '--tag-color': colorHex(color) } } : {}
})

function rowResource(database, table = null) {
  const segments = [{ kind: 'database', name: database }]
  if (table) segments.push({ kind: 'table', name: table })
  return createResourceRef(props.conn.id, segments)
}

function select(database, table = null) {
  setTreeSelection({
    resource: rowResource(database, table),
    connectionId: props.conn.id,
    connectionName: props.conn.name,
    engine: 'mysql',
    kind: table ? 'table' : 'database',
  })
}
const isSelected = (database, table = null) => sameResource(treeSelection.value?.resource, rowResource(database, table))
// The open table tab's row is highlighted too, as PostgreSQL's is.
const isOpen = (database, table) => sameResource(activeTab.value?.target, rowResource(database, table))
// The row whose right-click menu is open stays highlighted, as the other engines' do.
const ctxSel = (database, table = null) => sameResource(contextMenu.value?.nodeData?.resource, rowResource(database, table))

const openTable = (database, table) => openMySqlTable({ resource: rowResource(database, table), connectionName: props.conn.name })

function onContext(e, level, label, database, table = null) {
  const node = { connId: props.conn.id, connName: props.conn.name, engine: 'mysql', resource: rowResource(database, table) }
  contextMenu.value = { type: 'mysql:' + level, x: e.clientX, y: e.clientY, label, nodeData: node, items: MYSQL_MENUS[level] }
}
</script>

<template>
  <template v-for="database in shown" :key="database.name">
    <div
      class="tnode"
      :class="{ 'ctx-sel': ctxSel(database.name), sel: isSelected(database.name) }"
      v-bind="rowTag"
      style="padding-left: 21px"
      @click="toggleDatabase(database.name); select(database.name)"
      @contextmenu.prevent="onContext($event, 'database', database.name, database.name)"
    >
      <span class="tw"><BaseIcon :name="openDatabases[database.name] ? 'caretDown' : 'caret'" :size="12" /></span>
      <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
      <span class="tt">{{ database.name }}</span>
      <span v-if="tables[database.name]" class="cnt">({{ tables[database.name].length }})</span>
    </div>

    <div v-if="loading[database.name]" class="tnode" style="padding-left: 51px">
      <span class="mini-spin"></span>
      <span class="tt" style="color:var(--text-faint);font-size:11.5px">Loading…</span>
    </div>
    <div v-if="errors[database.name]" class="tnode err-node" style="padding-left: 51px">
      <span class="err-msg">{{ errors[database.name] }}</span>
      <span class="err-retry" @click.stop="toggleDatabase(database.name)">Retry</span>
    </div>

    <!-- information_schema lists only what the login may see, so empty can mean either. -->
    <div v-if="openDatabases[database.name] && tables[database.name]?.length === 0" class="tnode" style="padding-left: 51px">
      <span class="tt" style="color:var(--text-faint);font-size:11.5px;font-style:italic">No tables or views you can read</span>
    </div>
    <template v-if="openDatabases[database.name]">
      <template v-for="table in tables[database.name]" :key="table.name">
        <div
          class="tnode"
          :class="{ 'ctx-sel': ctxSel(database.name, table.name), sel: isSelected(database.name, table.name) || isOpen(database.name, table.name) }"
          v-bind="rowTag"
          style="padding-left: 51px"
          @click="select(database.name, table.name)"
          @dblclick="openTable(database.name, table.name)"
          @contextmenu.prevent="onContext($event, 'table', table.name, database.name, table.name)"
        >
          <span class="tw" @click.stop="toggleTable(database.name, table.name)"><BaseIcon :name="isTableOpen(database.name, table.name) ? 'caretDown' : 'caret'" :size="12" /></span>
          <span class="ti"><BaseIcon name="table" :size="15" /></span>
          <span class="tt">{{ table.name }}</span>
          <span
            v-if="table.estimatedRows != null"
            class="cnt"
            :title="`About ${table.estimatedRows.toLocaleString()} rows (MySQL's estimate, which for InnoDB can be far off)`"
          >{{ formatCompact(table.estimatedRows) }}</span>
        </div>
        <div v-if="tableError(database.name, table.name)" class="tnode err-node" style="padding-left: 66px">
          <span class="err-msg">{{ tableError(database.name, table.name) }}</span>
        </div>
        <template v-if="isTableOpen(database.name, table.name)">
          <div class="tnode" style="padding-left: 66px">
            <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
            <span class="ti"><BaseIcon name="folder" :size="15" /></span>
            <span class="tt">Columns</span>
            <span class="cnt">({{ columnsOf(database.name, table.name)?.length ?? '…' }})</span>
          </div>
          <div
            v-for="col in columnsOf(database.name, table.name) ?? []"
            :key="col.name"
            class="tnode col-node"
            style="padding-left: 96px"
          >
            <span class="ti" :class="{ pk: col.primaryKey, fk: col.references }">
              <BaseIcon :name="col.primaryKey ? 'key' : col.references ? 'uri' : 'textType'" :size="13" />
            </span>
            <span class="tt">{{ col.name }}</span>
            <span class="tmeta">{{ col.dataType }}<template v-if="col.primaryKey"> · PK</template><template v-if="col.references"> → {{ col.references }}</template><template v-if="!col.nullable && !col.primaryKey"> · not null</template></span>
          </div>
        </template>
      </template>
    </template>
  </template>

  <div v-if="systemCount" class="tnode" style="padding-left: 21px" @click="toggleSystem">
    <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
    <span class="ti"><BaseIcon :name="showSystem ? 'eye' : 'eyeOff'" :size="14" /></span>
    <span class="tt" style="color:var(--text-faint)">{{ showSystem ? 'Hide' : 'Show' }} MySQL's own databases</span>
    <span class="cnt">({{ systemCount }})</span>
  </div>
</template>

<!-- Scoped styles don't reach into child components, so this scopes the tree's
     stylesheet itself. -->
<style src="../../../components/connection/ConnectionTree.css" scoped></style>

<style scoped>
.col-node { cursor: default; }
.ti.pk { color: var(--warn); }
.ti.fk { color: var(--link); }
.tmeta { margin-left: 6px; font: 11px var(--mono); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; }
</style>
