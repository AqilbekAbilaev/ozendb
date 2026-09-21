<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { refreshFindWorkspacesAfterDocumentSave } from './utils/documentSaveRefresh'
import { useQueryRunner } from './composables/useQueryRunner'
import { useDbActions } from './composables/useDbActions'
import { useMenu } from './composables/useMenu'
import { useOperations } from './composables/useOperations'
import { useNodeTags } from './composables/useNodeTags'
import { useDbTransfer } from './composables/useDbTransfer'
import { useFeatures } from './composables/useFeatures'
import { useSessionPersistence } from './composables/useSessionPersistence'
import { useZoom } from './composables/useZoom'
import { useTabCreators } from './composables/useTabCreators'
import { showToast } from './stores/toast'
import { useAppMenuActions } from './composables/useAppMenuActions'
import {
  tabs, activeTabId,
  activateTab, closeTab, moveTab, handleTabAction,
} from './stores/tabs'
import {
  defaultQueryLimit,
  defaultResultView,
  loadSettings,
  restoreSessionEnabled,
} from './stores/settings'
import ConnectionTree from './components/connection/ConnectionTree.vue'
import WorkspaceArea from './components/workspace/WorkspaceArea.vue'
import ContextMenu from './components/base/ContextMenu.vue'
import { contextMenu } from './stores/contextMenu'
import AppModals from './components/app/AppModals.vue'
import AppToast from './components/app/AppToast.vue'
import Resizer from './components/base/Resizer.vue'
import Toolbar from './components/app/Toolbar.vue'
import OperationsPane from './components/panes/OperationsPane.vue'

import { listen } from '@tauri-apps/api/event';

let unlisten

onMounted(async () => {
  // The pop-out editor emits this after a save; refresh matching Find tabs explicitly,
  // since that isn't part of the restored-workspace lifecycle.
  unlisten = listen('document-saved', (e) => {
    refreshFindWorkspacesAfterDocumentSave(tabs.value, e.payload, runQuery)
  })

  // Settings must load before restoring tabs so new workspaces use the stored defaults.
  await loadSettings()

  // Session load always runs (migrates/validates a legacy file); tab restore is opt-in.
  await initializeSession({ restore: restoreSessionEnabled.value })

  startAutoSave()
});

onUnmounted(() => {
  stopAutoSave()
  unlisten.then(off => off())
});

// One-shot request from the native menu to the active collection's ResultsPanel; bumping
// `nonce` re-fires its watcher, `action` is the menu item id.
const toolbarHidden = ref(false)      // View → Hide Global Toolbar toggle

const sidebarWidth = ref(320)
const sidebarOpen = ref(true)   // the "Open connections" rail entry toggles the tree

const { operations, runningCount, clearFinished } = useOperations()
const { zoomIn, zoomOut, resetZoom } = useZoom({ showToast: showToast })
const operationsPaneOpen = ref(false)
const operationsPaneHeight = ref(200)

function toggleOperationsPane() {
  operationsPaneOpen.value = !operationsPaneOpen.value
}


const { applyColorTag } = useNodeTags()

const { runQuery, runAggregate, cancelQuery } = useQueryRunner({ showToast: showToast })

// Constructed here, not as free functions, since they need the query runner and settings defaults.
const {
  openCollectionTab,
  openSqlTab,
  openShellTab,
  openIndexManagerTab,
  openSchemaTab,
  openExportSource,
  openSearchTab, openCurrentOpsTab,
  openImportTab,
  openQuickstart,
} = useTabCreators({
  defaultQueryLimit: defaultQueryLimit,
  defaultResultView: defaultResultView,
  runQuery: runQuery,
})

const {
  openImportWizard,
  exportDatabase,
  importDatabase,
} = useDbTransfer({
  showToast: showToast,
  openImportTab: openImportTab,
})

const { initializeSession, startAutoSave, stopAutoSave } = useSessionPersistence()

const dbActionsApi = useDbActions({ showToast: showToast })

const { menuTarget } = useMenu()

const { handleContextAction, handleTool, menuNode, refreshAll } = useFeatures({
  dbActions: dbActionsApi,
  showToast: showToast, applyColorTag: applyColorTag, menuTarget: menuTarget,
  handleTabAction: handleTabAction, openCollectionTab: openCollectionTab,
  openShellTab: openShellTab, openIndexManagerTab: openIndexManagerTab, openSqlTab: openSqlTab,
  openSchemaTab: openSchemaTab,
  openSearchTab: openSearchTab, openCurrentOpsTab: openCurrentOpsTab,
  openExportSource: openExportSource, openImportWizard: openImportWizard,
  exportDatabase: exportDatabase, importDatabase: importDatabase,
})

useAppMenuActions({
  openQuickstart,
  menuTarget,
  openCollectionTab,
  handleTool,
  menuNode,
  showToast,
  refreshAll,
  zoomIn,
  zoomOut,
  resetZoom,
  toolbarHidden,
})
</script>

<template>
  <div class="app-layout">
    <!-- The menu bar is the native OS menu (installed from src-tauri/src/menu.rs);
         useAppMenuActions routes its clicks and, on Linux, its shortcuts. -->

    <!-- Toolbar -->
    <Toolbar :hidden="toolbarHidden" @tool="handleTool" />

    <!-- Main row -->
    <div class="app-main">
      <!-- Left rail -->
      <div class="rail-left">
        <button
          class="rail-toggle"
          :class="{ active: sidebarOpen }"
          type="button"
          :title="sidebarOpen ? 'Hide connections' : 'Show connections'"
          @click="sidebarOpen = !sidebarOpen"
        >
          <span class="rail-label">{{ sidebarOpen ? 'Hide connections' : 'Show connections' }}</span>
        </button>
        <button
          class="rail-toggle"
          :class="{ active: operationsPaneOpen }"
          style="margin-top:auto"
          type="button"
          :title="operationsPaneOpen ? 'Hide operations' : 'Show operations'"
          @click="toggleOperationsPane"
        >
          <span class="rail-label">Operations</span>
          <span v-if="runningCount" class="rail-badge">{{ runningCount }}</span>
        </button>
      </div>

      <!-- Sidebar -->
      <ConnectionTree
        v-show="sidebarOpen"
        :width="sidebarWidth"
        @select-collection="openCollectionTab"
      />
      <Resizer v-show="sidebarOpen" v-model="sidebarWidth" axis="x" :min="200" :max="560" />

      <!-- Workspace -->
      <WorkspaceArea
        :tabs="tabs"
        :active-tab-id="activeTabId"
        @activate-tab="activateTab"
        @close-tab="closeTab"
        @reorder-tab="moveTab"
        @run-query="runQuery"
        @run-aggregate="runAggregate"
        @cancel-query="cancelQuery"
        @follow-reference="openCollectionTab"
      />
    </div>

    <!-- Operations dock (bottom) -->
    <template v-if="operationsPaneOpen">
      <Resizer v-model="operationsPaneHeight" axis="y" :min="120" :max="560" invert />
      <div class="ops-dock" :style="{ height: operationsPaneHeight + 'px' }">
        <OperationsPane
          :operations="operations"
          @clear="clearFinished"
          @close="operationsPaneOpen = false"
        />
      </div>
    </template>

    <!-- Context menu -->
    <ContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      @close="contextMenu = null"
      @pick="handleContextAction"
    />

    <AppModals />

    <AppToast />
  </div>
</template>

<style src="./App.css" scoped></style>
