<script setup>
import { onUnmounted } from 'vue'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import IndexAddDialog from '../query/IndexAddDialog.vue'
import { indexKeyLabel } from '../../utils/indexSpec'
import { fmtBytes } from '../../utils/format'
import { useIndexManager } from '../../composables/useIndexManager'
import CollectionCrumbs from '../base/CollectionCrumbs.vue'
import FlexSpacer from '../base/FlexSpacer.vue'

// One Index Manager tab: everything it does lives in useIndexManager.
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const {
  localIndexesList, localIndexesLoading, localIndexesError, localSelectedIndex,
  localIndexTotalSize, localIndexUsageError, localIndexFormOpen, localIndexFormMode,
  localIndexFormSeed, localIndexCreating, localExpanded,
  hasSel, selProtected, selHidden,
  loadIndexes, selectRow, submitIndex, openCreateIndex, closeIndexForm, toggleHidden,
  handleStartEdit, handleViewDetails, handleDropIndex, handleCopyIndex, pasteIndex,
  toggleExpand, typeOf, propsOf, sizeOf, usageOf, release,
} = useIndexManager(() => props.activeTab)

onUnmounted(release)
</script>

<template>
  <div class="idxm">
    <!-- Breadcrumb -->
    <CollectionCrumbs :conn="activeTab.connectionName" :db="activeTab.dbName" :coll="activeTab.collectionName" icon="anchor" label="Indexes" />

    <!-- Toolbar -->
    <div class="idx-toolbar">
      <BaseButton variant="ghost" size="sm" icon="refresh" :icon-size="16" @click="loadIndexes()">Refresh</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="plus" :icon-size="16" @click="openCreateIndex()">Add index</BaseButton>
      <span class="tb-sep"></span>
      <BaseButton variant="ghost" size="sm" icon="trash" :icon-size="16" :disabled="!hasSel || selProtected" @click="handleDropIndex()">Drop index</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="edit" :icon-size="16" :disabled="!hasSel || selProtected" @click="handleStartEdit()">Edit index</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="eye" :icon-size="16" :disabled="!hasSel" @click="handleViewDetails()">View details</BaseButton>
      <BaseButton variant="ghost" size="sm" :icon="selHidden ? 'eye' : 'eyeOff'" :icon-size="16" :disabled="!hasSel || selProtected" @click="toggleHidden()">{{ selHidden ? 'Unhide index' : 'Hide index' }}</BaseButton>
      <span class="tb-sep"></span>
      <BaseButton variant="ghost" size="sm" icon="copy" :icon-size="16" :disabled="!hasSel" @click="handleCopyIndex()">Copy</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="paste" :icon-size="16" @click="pasteIndex()">Paste</BaseButton>
    </div>

    <!-- Index list -->
    <div class="idx-body">
      <div v-if="localIndexesLoading" class="idx-msg">Loading indexes…</div>
      <div v-else-if="localIndexesError" class="idx-msg idx-err">{{ localIndexesError }}</div>
      <table v-else class="idx-table">
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th class="col-type">Type</th>
            <th class="col-props">Properties</th>
            <th class="col-size">Size</th>
            <th class="col-usage">
              Usage
              <span
                v-if="localIndexUsageError"
                class="usage-warn"
                :title="`Index usage unavailable: ${localIndexUsageError}`"
              ><BaseIcon name="info" :size="12" /></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="index in localIndexesList" :key="index.name">
            <tr
              class="idx-row"
              :class="{ selected: localSelectedIndex && localSelectedIndex.name === index.name }"
              @click="selectRow(index)"
            >
              <td class="col-name">
                <span class="name-inner">
                  <BaseButton icon="caret" :icon-size="11" class="caret" :class="{ open: localExpanded[index.name] }" @click.stop="toggleExpand(index.name)" />
                  {{ index.name }}
                </span>
              </td>
              <td class="col-type">{{ typeOf(index) }}</td>
              <td class="col-props">{{ propsOf(index) }}</td>
              <td class="col-size">{{ sizeOf(index) }}</td>
              <td class="col-usage">{{ usageOf(index) }}</td>
            </tr>
            <tr v-if="localExpanded[index.name]" class="idx-detail">
              <td colspan="5"><span class="dt-label">Fields:</span> {{ indexKeyLabel(index) || '—' }}</td>
            </tr>
          </template>
          <tr v-if="!localIndexesList.length"><td colspan="5" class="idx-empty">No indexes.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Status bar -->
    <div class="idx-status">
      <span>{{ localIndexesList.length }} {{ localIndexesList.length === 1 ? 'Index' : 'Indexes' }}</span>
      <FlexSpacer />
      <span v-if="localIndexTotalSize != null">{{ fmtBytes(localIndexTotalSize, 'n/a') }}</span>
    </div>

    <!-- Add / Edit index dialog -->
    <IndexAddDialog
      v-if="localIndexFormOpen"
      :mode="localIndexFormMode"
      :seed="localIndexFormSeed"
      :busy="localIndexCreating"
      :error="localIndexesError"
      @submit="submitIndex"
      @cancel="closeIndexForm"
    />
  </div>
</template>

<style scoped>
.idxm { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }

/* Breadcrumb (mirrors the collection tab) */

/* Toolbar */
.idx-toolbar {
  display: flex; align-items: center; gap: 2px;
  padding: 5px 8px; background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border); flex: none;
}
.tb-sep { width: 1px; align-self: stretch; margin: 3px 6px; background: var(--border); }

/* Table */
.idx-body { flex: 1; overflow: auto; min-height: 0; }
.idx-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.idx-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 600; color: var(--text-dim);
  background: var(--bg-panel); padding: 6px 10px;
  border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-soft);
}
.idx-row td {
  padding: 5px 10px; color: var(--text); vertical-align: middle;
  border-bottom: 1px solid var(--grid-line); border-right: 1px solid var(--border-soft);
  white-space: nowrap;
}
.idx-row { cursor: pointer; }
.idx-row:hover { background: var(--bg-hover); }
.idx-row.selected { background: var(--accent); color: #fff; }
.idx-row.selected td { color: #fff; }
.col-name { white-space: nowrap; }
/* Marker on the Usage header when $indexStats failed (e.g. missing indexStats privilege).
   The tooltip carries the reason so "n/a" isn't a dead end. */
.usage-warn {
  display: inline-flex; align-items: center; vertical-align: middle;
  margin-left: 4px; color: var(--danger-text); cursor: help;
}
.name-inner { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; }
.base-btn.caret {
  border: none; background: transparent; padding: 0; cursor: pointer;
  color: var(--text-faint); display: inline-flex; transition: transform .12s;
}
.base-btn.caret.open { transform: rotate(90deg); }
.idx-row.selected .base-btn.caret { color: #fff; }
.idx-detail td {
  padding: 4px 10px 6px 30px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-row-alt); border-bottom: 1px solid var(--grid-line);
}
.dt-label { color: var(--text-faint); margin-right: 4px; }
.idx-empty { padding: 14px 10px; color: var(--text-dim); }
.idx-msg { padding: 14px; color: var(--text-dim); font-size: 12.5px; }
.idx-err { color: var(--danger-text); }

/* Status bar */
.idx-status {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-toolbar); border-top: 1px solid var(--border); flex: none;
}

</style>
