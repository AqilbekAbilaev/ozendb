<script setup>
import { computed, ref, watch } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import { usePostgresTree, visibleSchemas, isOpenTable, activeTableSchema, isSelectedNode } from './usePostgresTree.js'
import { activeTab } from '../../../stores/tabs'
import { openPostgresTable, openPostgresQuery } from '../../../stores/tabCreators'
import { contextMenu, contextActiveNodeKey, pgNodeKey } from '../../../stores/contextMenu'
import { treeSelection, setTreeSelection } from '../../../stores/connectionNavigation'
import { PG_MENUS } from './contextMenus.js'
import { tagOverrides } from '../../../stores/nodeTags'
import { colorHex, nodeTagName } from '../../../utils/tabColor.js'
import { formatCompact, fmtBytes } from '../../../utils/format'

const props = defineProps({
  conn: { type: Object, required: true },
  schemas: { type: Array, required: true },
  // ConnectionTree owns the hover card (it renders the single StatsTip), so the
  // handlers come down rather than a second instance being created here.
  statsTip: { type: Object, required: true },
})

const { toggleTable, isTableOpen, columnsOf, databaseSizes, databaseOpen, toggleDatabase, showSystem, toggleSystem, openSchemas, tables, loading, errors, toggleSchema, reloadTables } =
  usePostgresTree(props.conn.id)
// A refresh brings a new schema list; the open schemas' tables are re-read with it.
watch(() => props.schemas, reloadTables)
// The active table's row can only carry the highlight once it is rendered, so the tree
// opens down to it, as the sidebar does for MongoDB's active collection. `immediate`
// because this component is rebuilt whenever its connection is re-expanded — and because
// a restored session arrives with the tab already active.
watch(activeTab, (tab) => {
  const schema = activeTableSchema(tab, props.conn.id)
  if (!schema) return
  if (!databaseOpen.value) toggleDatabase()
  if (!openSchemas.value[schema]) toggleSchema(schema)
}, { immediate: true })
const shown = computed(() => visibleSchemas(props.schemas, showSystem.value))
const database = computed(() => props.conn.database || 'postgres')
// Read when the database row opens (see usePostgresTree); null until then, and null
// for a database this role may not connect to.
const databaseSize = computed(() => {
  const bytes = databaseSizes.value[database.value]
  return bytes ? fmtBytes(bytes) : null
})

function openQuery() {
  openPostgresQuery({ connectionId: props.conn.id, connectionName: props.conn.name, database: database.value })
}

// Every other non-template database on this server (#124) — same data
// `databaseSize` reads, fetched once the primary database row opens. A SQL tab
// against one targets it via `runQuery`'s `database` override, reusing this
// connection's pool/tunnel/credentials rather than opening a second connection.
const otherDatabasesOpen = ref(false)
const otherDatabases = computed(() =>
  Object.keys(databaseSizes.value).filter(name => name !== database.value).sort(),
)
function openOtherQuery(name) {
  openPostgresQuery({ connectionId: props.conn.id, connectionName: props.conn.name, database: name })
}

// Rows below the connection have no colours of their own yet, so they all show the
// connection's, as MongoDB's rows inherit their nearest coloured ancestor's.
const color = computed(() => nodeTagName(tagOverrides.value, props.conn.id, props.conn.tag))
const tagStyle = computed(() => (color.value ? { '--tag-color': colorHex(color.value) } : null))

// Clicking a row selects it, which is what the native menu's PostgreSQL gates read
// (#145) — without this the menu could only ever target an open tab. Both
// spellings of the database name ride along: `dbName` is what the shared selection
// store's ref builder reads, `database` is what every PostgreSQL consumer uses.
function select(kind, schemaName = null, tableName = null) {
  setTreeSelection({
    connectionId: props.conn.id,
    connectionName: props.conn.name,
    engine: 'postgresql',
    dbName: database.value,
    database: database.value,
    schema: schemaName,
    table: tableName,
    kind: kind,
  })
}
const isSelected = (kind, schemaName = null, tableName = null) =>
  isSelectedNode(treeSelection.value, props.conn.id, kind, schemaName, tableName)

// The row whose right-click menu is open stays highlighted, as MongoDB's rows do.
const ctxSel = (level, schema, table) => contextActiveNodeKey.value === pgNodeKey(level, { connId: props.conn.id, schema, table })

// Right-click on a row: `level` picks its menu, `extra` names the schema/table under it.
function onContext(e, level, label, extra = {}) {
  const node = { connId: props.conn.id, connName: props.conn.name, engine: 'postgresql', database: database.value, ...extra }
  contextMenu.value = { type: 'pg:' + level, x: e.clientX, y: e.clientY, label, nodeData: node, items: PG_MENUS[level] }
}

function openTable(schema, table) {
  openPostgresTable({
    connectionId: props.conn.id,
    connectionName: props.conn.name,
    database: database.value,
    schema,
    table,
  })
}
</script>

<template>
  <!-- A connection is bound to one database; it's the only one there is to browse. -->
  <div
    class="tnode"
    :class="{ 'ctx-sel': ctxSel('database'), sel: isSelected('database'), tagged: !!color }"
    :style="tagStyle"
    style="padding-left: 21px"
    @click="toggleDatabase(); select('database')"
    @contextmenu.prevent="onContext($event, 'database', database)"
  >
    <span class="tw"><BaseIcon :name="databaseOpen ? 'caretDown' : 'caret'" :size="12" /></span>
    <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
    <span class="tt">{{ database }}</span>
    <span v-if="shown.length" class="cnt">({{ shown.length }})</span>
    <span v-if="databaseSize" class="cnt" :title="`${database} is ${databaseSize} on disk`">{{ databaseSize }}</span>
    <span
      class="row-action push"
      :class="{ on: showSystem }"
      :title="showSystem ? 'Hide PostgreSQL\'s own schemas' : 'Show PostgreSQL\'s own schemas'"
      @click.stop="toggleSystem"
    >
      <BaseIcon :name="showSystem ? 'eye' : 'eyeOff'" :size="14" />
    </span>
    <span class="row-action" title="New SQL query" @click.stop="openQuery">
      <BaseIcon name="sql" :size="14" />
    </span>
  </div>

  <template v-if="databaseOpen">
    <template v-for="schema in shown" :key="schema.name">
      <div
        class="tnode"
        :class="{ 'ctx-sel': ctxSel('schema', schema.name), sel: isSelected('schema', schema.name), tagged: !!color }"
        :style="tagStyle"
        style="padding-left: 36px"
        @click="toggleSchema(schema.name); select('schema', schema.name)"
        @contextmenu.prevent="onContext($event, 'schema', schema.name, { schema: schema.name })"
      >
        <span class="tw"><BaseIcon :name="openSchemas[schema.name] ? 'caretDown' : 'caret'" :size="12" /></span>
        <span class="ti"><BaseIcon name="folder" :size="15" /></span>
        <span class="tt">{{ schema.name }}</span>
        <span v-if="tables[schema.name]" class="cnt">({{ tables[schema.name].length }})</span>
      </div>

      <div v-if="loading[schema.name]" class="tnode" style="padding-left: 66px">
        <span class="mini-spin"></span>
        <span class="tt" style="color:var(--text-faint);font-size:11.5px">Loading…</span>
      </div>
      <div v-if="errors[schema.name]" class="tnode err-node" style="padding-left: 66px">
        <span class="err-msg">{{ errors[schema.name] }}</span>
        <span class="err-retry" @click.stop="toggleSchema(schema.name)">Retry</span>
      </div>

      <!-- information_schema lists only what the role may see, so empty can mean either. -->
      <div v-if="openSchemas[schema.name] && tables[schema.name]?.length === 0" class="tnode" style="padding-left: 66px">
        <span class="tt" style="color:var(--text-faint);font-size:11.5px;font-style:italic">No tables or views you can read</span>
      </div>
      <template v-if="openSchemas[schema.name]">
        <template v-for="table in tables[schema.name]" :key="table.name">
          <div
            class="tnode"
            :class="{
              'ctx-sel': ctxSel('table', schema.name, table.name),
              sel: isOpenTable(activeTab, conn.id, schema.name, table.name)
                || isSelected('table', schema.name, table.name),
              tagged: !!color,
            }"
            :style="tagStyle"
            style="padding-left: 66px"
            @click="select('table', schema.name, table.name)"
            @dblclick="openTable(schema.name, table.name)"
            @contextmenu.prevent="onContext($event, 'table', table.name, { schema: schema.name, table: table.name })"
            @mouseenter="table.kind !== 'view' && statsTip.show($event, { connId: conn.id, engine: 'postgresql', schema: schema.name, table: table.name })"
            @mousemove="statsTip.move"
            @mouseleave="statsTip.hideSoon"
          >
            <span class="tw" @click.stop="toggleTable(schema.name, table.name)">
              <BaseIcon :name="isTableOpen(schema.name, table.name) ? 'caretDown' : 'caret'" :size="12" />
            </span>
            <span class="ti"><BaseIcon name="table" :size="15" /></span>
            <span class="tt">{{ table.name }}</span>
            <span
              v-if="table.estimatedRows != null"
              class="cnt"
              :title="`About ${table.estimatedRows.toLocaleString()} rows (PostgreSQL's estimate)`"
            >{{ formatCompact(table.estimatedRows) }}</span>
          </div>
          <template v-if="isTableOpen(schema.name, table.name)">
            <div class="tnode" style="padding-left: 81px">
              <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
              <span class="ti"><BaseIcon name="folder" :size="15" /></span>
              <span class="tt">Columns</span>
              <span class="cnt">({{ columnsOf(schema.name, table.name)?.length ?? '…' }})</span>
            </div>
            <div
              v-for="col in columnsOf(schema.name, table.name) ?? []"
              :key="col.name"
              class="tnode col-node"
              style="padding-left: 111px"
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

    <!-- Every other database on this server (#124) — a connection still binds
         to one database to browse, but a SQL tab against another reuses the same
         pool/tunnel/credentials instead of a dead click. -->
    <div
      v-if="otherDatabases.length"
      class="tnode"
      style="padding-left: 36px"
      @click="otherDatabasesOpen = !otherDatabasesOpen"
    >
      <span class="tw"><BaseIcon :name="otherDatabasesOpen ? 'caretDown' : 'caret'" :size="12" /></span>
      <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
      <span class="tt">Other databases</span>
      <span class="cnt">({{ otherDatabases.length }})</span>
    </div>
    <template v-if="otherDatabasesOpen">
      <div
        v-for="name in otherDatabases"
        :key="name"
        class="tnode"
        style="padding-left: 51px"
      >
        <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
        <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
        <span class="tt">{{ name }}</span>
        <span v-if="databaseSizes[name]" class="cnt" :title="`${name} is ${fmtBytes(databaseSizes[name])} on disk`">{{ fmtBytes(databaseSizes[name]) }}</span>
        <span class="row-action push" title="New SQL query" @click.stop="openOtherQuery(name)">
          <BaseIcon name="sql" :size="14" />
        </span>
      </div>
    </template>
  </template>
</template>

<!-- Scoped styles don't reach into child components, so this scopes the tree's
     stylesheet itself. -->
<style src="../../../components/connection/ConnectionTree.css" scoped></style>

<style scoped>
.row-action {
  padding: 0 4px;
  color: var(--text-dim); opacity: 0; cursor: pointer;
}
.row-action.push { margin-left: auto; }
.col-node { cursor: default; }
.ti.pk { color: var(--warn); }
.ti.fk { color: var(--link); }
.tmeta { margin-left: 6px; font: 11px var(--mono); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; }
.tnode:hover .row-action, .row-action.on { opacity: 1; }
.row-action:hover { color: var(--text); }
</style>
