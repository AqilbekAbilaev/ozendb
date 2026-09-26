<script setup>
import { computed } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import { usePostgresTree, visibleSchemas } from './usePostgresTree.js'
import { openPostgresTable } from '../../../stores/tabCreators'

const props = defineProps({
  conn: { type: Object, required: true },
  schemas: { type: Array, required: true },
})

const { databaseOpen, toggleDatabase, openSchemas, tables, loading, errors, toggleSchema } =
  usePostgresTree(props.conn.id)
const shown = computed(() => visibleSchemas(props.schemas))
const database = computed(() => props.conn.database || 'postgres')

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
  <div class="tnode" style="padding-left: 21px" @click="toggleDatabase">
    <span class="tw"><BaseIcon :name="databaseOpen ? 'caretDown' : 'caret'" :size="12" /></span>
    <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
    <span class="tt">{{ database }}</span>
    <span v-if="shown.length" class="cnt">({{ shown.length }})</span>
  </div>

  <template v-if="databaseOpen">
    <template v-for="schema in shown" :key="schema.name">
      <div class="tnode" style="padding-left: 36px" @click="toggleSchema(schema.name)">
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

      <template v-if="openSchemas[schema.name]">
        <div
          v-for="table in tables[schema.name]"
          :key="table.name"
          class="tnode"
          style="padding-left: 66px"
          @dblclick="openTable(schema.name, table.name)"
        >
          <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
          <span class="ti"><BaseIcon name="collSmall" :size="15" /></span>
          <span class="tt">{{ table.name }}</span>
        </div>
      </template>
    </template>
  </template>
</template>

<!-- Scoped styles don't reach into child components, so this scopes the tree's
     stylesheet itself. -->
<style src="../../../components/connection/ConnectionTree.css" scoped></style>
