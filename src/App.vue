<script setup>
import { ref } from 'vue'
import { runQuery, runAggregate, cancelQuery } from './stores/queryRunner'
import { openCollectionTab } from './stores/tabCreators'
import { useMenu } from './composables/useMenu'
import { useOperations } from './composables/useOperations'
import { useFeatures } from './composables/useFeatures'
import { useAppMenuActions } from './composables/useAppMenuActions'
import {
  tabs, activeTabId,
  activateTab, closeTab, moveTab,
} from './stores/tabs'
import ConnectionTree from './components/connection/ConnectionTree.vue'
import WorkspaceArea from './components/workspace/WorkspaceArea.vue'
import ContextMenu from './components/base/ContextMenu.vue'
import { contextMenu } from './stores/contextMenu'
import AppModals from './components/app/AppModals.vue'
import AppToast from './components/app/AppToast.vue'
import Resizer from './components/base/Resizer.vue'
import Toolbar from './components/app/Toolbar.vue'
import OperationsPane from './components/panes/OperationsPane.vue'

const toolbarHidden = ref(false)      // View → Hide Global Toolbar toggle

const sidebarWidth = ref(320)
const sidebarOpen = ref(true)   // the "Open connections" rail entry toggles the tree

const { operations, runningCount, clearFinished } = useOperations()
const operationsPaneOpen = ref(false)
const operationsPaneHeight = ref(200)

function toggleOperationsPane() {
  operationsPaneOpen.value = !operationsPaneOpen.value
}

const { menuTarget } = useMenu()

const { handleContextAction, handleTool, menuNode, refreshAll } = useFeatures({ menuTarget })

useAppMenuActions({ menuTarget, handleTool, menuNode, refreshAll, toolbarHidden })
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
