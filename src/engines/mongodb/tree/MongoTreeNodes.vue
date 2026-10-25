<script setup>
import BaseIcon from '../../../components/base/BaseIcon.vue'
import { useMongoTree } from './useMongoTree.js'
import { contextMenu, contextActiveNodeKey } from '../../../stores/contextMenu'
import { setTreeSelection } from '../../../stores/connectionNavigation'
import { tagOverrides } from '../../../stores/nodeTags'
import { colorHex, nodeTagName } from '../../../utils/tabColor.js'
import { appendResource, createResourceRef } from '../../../utils/resourceRef'

// One MongoDB connection's rows below it in the sidebar: its databases and their collections.
const props = defineProps({
  conn: { type: Object, required: true },
  resources: { type: Array, required: true },
  statsTip: { type: Object, required: true },
})

const {
  selectedKey, activeCollectionKey, isDatabaseOpen, databaseKey, collectionKey,
  toggleDatabase, highlightCollection, openCollection,
} = useMongoTree()
const setSelection = setTreeSelection

const nodeTag = (key, fallbackTag) => nodeTagName(tagOverrides.value, key, fallbackTag)

// Effective colours cascade down the tree: a node shows its own colour if it has one,
// otherwise it inherits the nearest coloured ancestor's, up to the connection's.
function dbColor(conn, dbName) {
  return nodeTag(databaseKey(conn.id, dbName), null) || nodeTag(conn.id, conn.tag)
}
function collColor(conn, dbName, collName) {
  return nodeTag(collectionKey(conn.id, dbName, collName), null) || dbColor(conn, dbName)
}

// A database row's ResourceRef; a collection row's appends its own name to it.
const dbResource = (conn, dbName) => createResourceRef(conn.id, [{ kind: 'database', name: dbName }])

function onNodeContext(e, type, label, nodeData) {
  // The stats card opens at the pointer, which is exactly where the menu is about to
  // appear — drop it at once rather than leaving it to the hover grace period.
  props.statsTip.hide()
  contextMenu.value = { type: type, x: e.clientX, y: e.clientY, label: label, nodeData: nodeData }
}
</script>

<template>
  <template v-for="db in resources" :key="db.name">
    <!-- Database row -->
    <div
      class="tnode"
      :class="{
        tagged: !!dbColor(conn, db.name),
        locked: !db.accessible,
        'ctx-sel': contextActiveNodeKey === databaseKey(conn.id, db.name),
      }"
      :style="dbColor(conn, db.name) ? { '--tag-color': colorHex(dbColor(conn, db.name)) } : null"
      style="padding-left: 21px"
      @click="db.accessible ? toggleDatabase(conn, db.name) : setSelection(null)"
      @contextmenu.prevent="onNodeContext($event, 'database', db.name, { resource: dbResource(conn, db.name), connectionName: conn.name })"
      @mouseenter="db.accessible && statsTip.show($event, { connId: conn.id, dbName: db.name })"
      @mousemove="statsTip.move"
      @mouseleave="statsTip.hideSoon"
    >
      <span class="tw">
        <BaseIcon v-if="!db.accessible" name="lock" :size="12" />
        <BaseIcon v-else :name="isDatabaseOpen(conn.id, db.name) ? 'caretDown' : 'caret'" :size="12" />
      </span>
      <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
      <span class="tt">{{ db.name }}</span>
      <span v-if="db.accessible && db.collections.length" class="cnt">({{ db.collections.length }})</span>
    </div>

    <!-- Collections -->
    <template v-if="isDatabaseOpen(conn.id, db.name)">
      <div
        v-for="coll in db.collections"
        :key="coll"
        class="tnode"
        :class="{
          sel: activeCollectionKey === collectionKey(conn.id, db.name, coll)
            || selectedKey === collectionKey(conn.id, db.name, coll),
          'ctx-sel': contextActiveNodeKey === collectionKey(conn.id, db.name, coll),
          tagged: !!collColor(conn, db.name, coll),
        }"
        :style="collColor(conn, db.name, coll) ? { '--tag-color': colorHex(collColor(conn, db.name, coll)) } : null"
        style="padding-left: 51px"
        @click="highlightCollection(conn, db, coll)"
        @dblclick="openCollection(conn, db, coll)"
        @mouseenter="statsTip.show($event, { connId: conn.id, dbName: db.name, collName: coll })"
        @mousemove="statsTip.move"
        @mouseleave="statsTip.hideSoon"
        @contextmenu.prevent="onNodeContext($event, 'collection', coll, { resource: appendResource(dbResource(conn, db.name), 'collection', coll), connectionName: conn.name })"
      >
        <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
        <span class="ti"><BaseIcon name="collSmall" :size="15" /></span>
        <span class="tt">{{ coll }}</span>
      </div>
    </template>
  </template>
</template>

<style src="../../../components/connection/ConnectionTree.css" scoped></style>
