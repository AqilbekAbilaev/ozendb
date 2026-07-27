<script setup>
import { ref, computed, inject } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText } from '../../utils/errors'
import { parseField } from '../../utils/queryParser'
import BaseIcon from '../base/BaseIcon.vue'
import FieldEditModal from './FieldEditModal.vue'
import UpdateDocumentsModal from './UpdateDocumentsModal.vue'
import DeleteDocumentsModal from './DeleteDocumentsModal.vue'
import VisualQueryBuilder from '../query/VisualQueryBuilder.vue'
import ResultTable from './ResultTable.vue'
import StateMessage from '../base/StateMessage.vue'
import JsonResultView from './JsonResultView.vue'
import TreeResultView from './TreeResultView.vue'
import ExplainResultView from './ExplainResultView.vue'
import QueryCodeView from './QueryCodeView.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import ContextMenu from '../base/ContextMenu.vue'
import TabStrip from '../base/TabStrip.vue'
import Resizer from '../base/Resizer.vue'
import FieldError from '../base/FieldError.vue'
import { useDocumentActions } from '../../composables/useDocumentActions'
import { useToast } from '../../composables/useToast'
import { PAGE_SIZES } from '../../constants/pageSizes'

const props = defineProps({
  activeTab:   { type: Object,  required: true },
  isAggregate: { type: Boolean, default: false },
  runValid:    { type: Boolean, default: true },
  rtab:        { type: String,  default: 'Result' },
  vqbOpen:     { type: Boolean, default: false },
  tabs:        { type: Array,   required: true },
  activeTabId: { type: String,  required: true },
  // One-shot Document/Collection editing request from the native menu (see App.vue's
  // requestDocMenuAction). `{ action, nonce }`; a new nonce re-fires the dispatch.
  docMenuRequest: { type: Object, default: null },
})

// `run` re-runs the active tab in its current mode (the toolbar refresh button).
// `requery` re-runs the find query with an explicit history flag (pagination, CRUD
// refresh). Both delegate to the parent, which owns the parse + run pipeline.
const emit = defineEmits(['run', 'requery', 'select-rtab', 'explain-verbosity', 'open-vqb', 'close-vqb', 'cancel', 'follow-reference'])
const { showToast } = useToast()

// The Table/JSON/Tree view lives on the active tab, so each tab keeps its own view;
// a tab that has none yet falls back to the configured default (Preferences → General).
const defaultResultView = inject('defaultResultView', ref('table'))
const viewMode = computed({
  get() {
    return props.activeTab && props.activeTab.resultView ? props.activeTab.resultView : defaultResultView.value
  },
  set(value) {
    if (props.activeTab) props.activeTab.resultView = value
  },
})
const viewMenu     = ref(false)
const pageSizeMenu = ref(false)

// Drag-to-VQB signals originate in the grid (ResultTable) and are forwarded to
// VisualQueryBuilder, which sits beside the grid here. ResultTable owns the gesture;
// these plain refs just relay its latest field / section / drop to the VQB props.
const draggedField    = ref('')
const dragOverSection = ref(null)
const vqbDrop         = ref(null)

// ── VQB panel resize ──────────────────────────────────────
// A <Resizer> bar between the grid and the panel. The panel is on the right, so
// dragging left grows it (invert). Width resets to the default each session.
const vqbWidth = ref(360)


// ── pagination ─────────────────────────────────────────

function goFirst() {
  const tab = props.activeTab
  if (!tab) return
  tab.skip = 0
  emit('requery', false)
}

function goPrev() {
  const tab = props.activeTab
  if (!tab) return
  tab.skip = Math.max(0, (tab.skip || 0) - (tab.limit || 50))
  emit('requery', false)
}

function goNext() {
  const tab = props.activeTab
  if (!tab) return
  tab.skip = (tab.skip || 0) + (tab.limit || 50)
  emit('requery', false)
}

// Count the documents matching the tab's current filter. The result is cached on
// the tab together with the filter it was counted for, so the "of N" total is
// only shown while it still matches the active filter (see rangeText).
async function fetchCount(tab) {
  // Convert the tab's shell-syntax filter to canonical Extended JSON before sending,
  // exactly as the run-query path does — the backend's parser is strict and rejects
  // shell conveniences like unquoted keys.
  const parsed = parseField(tab.filter || '')
  if (!parsed.ok) throw new Error(parsed.error)
  const filter = parsed.ejson
  const total = await invoke('count_documents', {
    id:         tab.connectionId,
    database:   tab.dbName,
    collection: tab.collectionName,
    filter:     filter,
  })
  tab.total = total
  tab.totalFilter = filter
  return total
}

async function goLast() {
  const tab = props.activeTab
  if (!tab) return
  try {
    const total = await fetchCount(tab)
    const limit = tab.limit || 50
    // Land on the page whose first row is the last full page boundary.
    tab.skip = total === 0 ? 0 : Math.floor((total - 1) / limit) * limit
    emit('requery', false)
  } catch (e) {
    showToast('Count failed: ' + errText(e))
  }
}

async function countDocuments() {
  const tab = props.activeTab
  // Ignore clicks while a count is already in flight: on a large collection each
  // count is a heavy server op, so this stops rapid clicks from stacking counts
  // (and sidesteps out-of-order results — only one runs at a time).
  if (!tab || isCountDisabled.value || tab.isCounting) return
  tab.isCounting = true
  try {
    await fetchCount(tab)
    // Show the total on the button itself (see countText); it stays until the
    // next run clears the flag or the filter changes.
    tab.countShown = true
  } catch (e) {
    showToast('Count failed: ' + errText(e))
  } finally {
    tab.isCounting = false
  }
}

function setPageSize(size) {
  const tab = props.activeTab
  if (!tab) return
  tab.limit = size
  pageSizeMenu.value = false
  emit('requery', true)
}

// ── document CRUD + field edits + Document/Collection menu dispatch ──
// The whole cluster (insert/edit/delete, field-level edits, drill navigation, the
// clear-collection flow, and the native-menu action router) lives in a composable so
// this component stays focused on laying out the result views.
const {
  drillPath,
  showDeleteConfirm, selectedCount, crudError,
  openInsert, openEdit, openView, copySelectedDocument, onDeleteConfirm,
  fieldEdit, fieldEditError, removeFieldName, removeFieldError,
  showUpdateDialog, showDeleteDialog, showClearConfirm, clearConfirmText, clearBusy, clearError,
  onFieldEditSave, onRemoveFieldConfirm, onClearConfirm, onUpdateDialogDone, onDeleteDialogDone,
} = useDocumentActions({
  activeTab: () => props.activeTab,
  docMenuRequest: () => props.docMenuRequest,
  viewMode: viewMode,
  showToast: showToast,
  requery: (history) => emit('requery', history),
})

// ── paging range / count ──────────────────────────────
// "<from> to <to>" of the current page, skip-aware; appends "of <N>" only when a
// count has been taken for the still-current filter.
const rangeText = computed(() => {
  const tab = props.activeTab
  const len = tab?.results?.length ?? 0
  if (!len) return '-- to --'
  const skip = tab.skip || 0
  const base = `${skip + 1} to ${skip + len}`
  // Compare in canonical Extended JSON so the stored count (see fetchCount) matches
  // the active filter regardless of shell-syntax/whitespace differences.
  const parsed = parseField(tab.filter || '')
  const curFilter = parsed.ok ? parsed.ejson : null
  if (tab.total != null && curFilter != null && tab.totalFilter === curFilter) {
    return `${base} of ${tab.total.toLocaleString()}`
  }
  return base
})

// Count applies to a find filter; aggregate pipelines have no single filter.
const isCountDisabled = computed(() =>
  props.isAggregate || !props.activeTab || props.activeTab.kind !== 'collection'
)

// The counted total shown inline on the "Count Documents" button — only while it
// belongs to the current run (countShown, cleared by the runner on every new run)
// and still matches the active filter (same validity check as rangeText). Null
// otherwise, so the label reverts to a plain "Count Documents".
const countText = computed(() => {
  const tab = props.activeTab
  if (!tab || isCountDisabled.value || tab.total == null || !tab.countShown) return null
  const parsed = parseField(tab.filter || '')
  const curFilter = parsed.ok ? parsed.ejson : null
  if (curFilter != null && tab.totalFilter === curFilter) {
    return tab.total.toLocaleString()
  }
  return null
})

// Right-clicking the shown count offers "Copy value to clipboard" (Studio-3T style).
// Only armed when there's a count to copy — otherwise the native menu is left alone.
const countMenu = ref(null)
function onCountContext(e) {
  if (countText.value == null) return
  e.preventDefault()
  countMenu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [{ label: 'Copy value to clipboard', icon: 'copy' }],
  }
}
function copyCountValue() {
  const tab = props.activeTab
  countMenu.value = null
  // Copy the raw number (no thousands separators) so it pastes cleanly into
  // spreadsheets or reports.
  if (tab && tab.total != null) {
    navigator.clipboard.writeText(String(tab.total)).catch(() => {})
  }
}

// Bulk Update / Delete dialogs target a whole collection by query, so they're only
// meaningful on a collection tab (not aggregate output, not IntelliShell results).
const isCollection = computed(() =>
  !props.isAggregate && !!props.activeTab && props.activeTab.kind === 'collection'
)

// Read-only mode is a per-tab guard against accidental writes: it greys out the
// mutating toolbar actions and disables inline cell editing in the grid below. It's
// view state, so it lives on the tab and simply defaults off (falsy) for old tabs.
function toggleReadOnly() {
  const tab = props.activeTab
  if (!tab) return
  tab.readOnly = !tab.readOnly
}

</script>

<template>
  <div class="results">
    <div class="result-content">
    <!-- Result sub-tabs -->
    <div class="rtabs">
      <TabStrip
        :model-value="rtab"
        :options="[{ value: 'Result', label: 'Result' }, { value: 'Query Code', label: 'Query Code' }, { value: 'Explain', label: 'Explain' }]"
        @update:model-value="emit('select-rtab', $event)"
      />
    </div>

    <!-- Result toolbar -->
    <div class="rtoolbar" v-if="rtab === 'Result'">
      <BaseButton icon="refresh" :icon-size="18" @click="emit('run')" :disabled="activeTab.isRunning || !runValid" />
      <BaseButton v-if="activeTab.isRunning" size="sm" bordered @click="emit('cancel')" title="Cancel the running query">
        <BaseIcon name="close" :size="13" /> Cancel
      </BaseButton>
      <BaseButton icon="first" :icon-size="18"
        :disabled="isAggregate || !activeTab.hasRun || (activeTab.skip || 0) === 0 || activeTab.isRunning"
        @click="goFirst" />
      <BaseButton icon="prev" :icon-size="18"
        :disabled="isAggregate || !activeTab.hasRun || (activeTab.skip || 0) === 0 || activeTab.isRunning"
        @click="goPrev" />
      <BaseButton icon="next" :icon-size="18"
        :disabled="isAggregate || !activeTab.hasRun || (activeTab.results?.length ?? 0) < (activeTab.limit || 50) || activeTab.isRunning"
        @click="goNext" />
      <BaseButton icon="last" :icon-size="18"
        :disabled="isAggregate || !activeTab.hasRun || (activeTab.results?.length ?? 0) < (activeTab.limit || 50) || activeTab.isRunning"
        @click="goLast" />
      <div class="page-size-wrap">
        <span class="page-size" @click="pageSizeMenu = !pageSizeMenu">
          {{ activeTab.limit || 50 }} <BaseIcon name="caretDown" :size="12" />
        </span>
        <div v-if="pageSizeMenu" class="page-size-menu">
          <div
            v-for="sz in PAGE_SIZES"
            :key="sz"
            class="psm-item"
            :class="{ on: (activeTab.limit || 50) === sz }"
            @click="setPageSize(sz)"
          >{{ sz }}</div>
        </div>
      </div>
      <span class="docs-range">
        Documents {{ rangeText }}
      </span>
      <BaseButton icon="lock" :icon-size="18" :active="activeTab.readOnly"
        :title="activeTab.readOnly ? 'Read-only mode is on — click to allow edits' : 'Read-only mode (block accidental edits)'"
        @click="toggleReadOnly" />
      <BaseButton icon="plus" :icon-size="18" title="Add document"
        :disabled="!activeTab.hasRun || activeTab.isRunning || activeTab.readOnly"
        @click="openInsert" />
      <BaseButton icon="eye" :icon-size="18" title="View document (read-only)"
        :disabled="activeTab.selectedRow < 0"
        @click="openView" />
      <BaseButton icon="edit" :icon-size="18" title="Edit document"
        :disabled="activeTab.selectedRow < 0 || activeTab.readOnly"
        @click="openEdit" />
      <BaseButton icon="copy" :icon-size="18" title="Copy document"
        :disabled="activeTab.selectedRow < 0"
        @click="copySelectedDocument" />
      <BaseButton icon="trash" :icon-size="18" title="Delete document"
        :disabled="activeTab.selectedRow < 0 || activeTab.readOnly"
        @click="showDeleteConfirm = true; crudError = null" />
      <BaseButton icon="updateDialog" :icon-size="18" title="Update documents by query…"
        :disabled="!isCollection || !activeTab.hasRun || activeTab.isRunning || activeTab.readOnly"
        @click="showUpdateDialog = true" />
      <BaseButton icon="deleteDialog" :icon-size="18" title="Delete documents by query…"
        :disabled="!isCollection || !activeTab.hasRun || activeTab.isRunning || activeTab.readOnly"
        @click="showDeleteDialog = true" />
      <span class="rtoolbar-spacer"></span>

      <!-- View mode selector -->
      <div class="view-select-wrap">
        <span class="view-select" @click="viewMenu = !viewMenu">
          {{ { table: 'Table View', json: 'JSON View', tree: 'Tree View' }[viewMode] }}
          <BaseIcon name="caretDown" :size="12" />
        </span>
        <div v-if="viewMenu" class="view-menu">
          <div
            v-for="[k, label] in [['table','Table View'],['json','JSON View'],['tree','Tree View']]"
            :key="k"
            class="view-menu-item"
            :class="{ on: viewMode === k }"
            @click="viewMode = k; viewMenu = false"
          >
            <BaseIcon v-if="viewMode === k" name="check" :size="13" />
            <span>{{ label }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Result-tab states: error / loading / empty (shared placeholder) -->
    <StateMessage
      v-if="rtab === 'Result' && activeTab.runError"
      mode="error"
      :message="activeTab.runError"
      :code="activeTab.runErrorCode"
      retryable
      @retry="emit('run')"
    />
    <StateMessage
      v-else-if="rtab === 'Result' && activeTab.isRunning"
      mode="loading"
      label="Running query…"
    />
    <StateMessage
      v-else-if="rtab === 'Result' && activeTab.hasRun && !activeTab.results?.length"
      mode="empty"
    />

    <!-- Table view -->
    <ResultTable
      v-else-if="rtab === 'Result' && viewMode === 'table'"
      :active-tab="activeTab"
      :readonly="!!activeTab.readOnly"
      :vqb-open="vqbOpen"
      v-model:drillPath="drillPath"
      @dragged-field="draggedField = $event"
      @drag-over-section="dragOverSection = $event"
      @vqb-drop="vqbDrop = $event"
      @open-vqb="emit('open-vqb')"
      @close-vqb="emit('close-vqb')"
      @crud-error="crudError = $event"
      @follow-reference="emit('follow-reference', $event)"
    />

    <!-- JSON view -->
    <JsonResultView
      v-else-if="rtab === 'Result' && viewMode === 'json'"
      :results="activeTab.results"
    />

    <!-- Tree view -->
    <TreeResultView
      v-else-if="rtab === 'Result' && viewMode === 'tree'"
      :results="activeTab.results"
    />

    <!-- Query Code sub-tab -->
    <QueryCodeView
      v-else-if="rtab === 'Query Code'"
      :active-tab="activeTab"
    />

    <!-- Explain sub-tab -->
    <ExplainResultView
      v-else-if="rtab === 'Explain'"
      :active-tab="activeTab"
      @explain-verbosity="emit('explain-verbosity', $event)"
    />

    <!-- Other sub-tabs placeholder -->
    <div v-else class="empty-rows" style="padding:32px;color:var(--text-faint);font-size:12px;display:flex;align-items:center;justify-content:center">
      {{ rtab }} — coming soon
    </div>

    <!-- Footer -->
    <div class="rfooter">
      <span>{{ activeTab.selectedRow >= 0 ? '1 document selected' : '0 documents selected' }}</span>
      <span class="spacer"></span>
      <BaseButton
        variant="ghost"
        size="sm"
        icon="count"
        :icon-size="14"
        :disabled="isCountDisabled"
        :active="activeTab.isCounting"
        @click="countDocuments"
        @contextmenu="onCountContext"><template v-if="activeTab.isCounting">Counting…</template><template v-else>Count Documents<template v-if="countText != null">: {{ countText }}</template></template></BaseButton>
      <span class="fitem" v-if="activeTab.elapsedMs != null">
        <BaseIcon name="clock" :size="14" />
        {{ (activeTab.elapsedMs / 1000).toFixed(3) }}s
      </span>
    </div>
    </div><!-- /result-content -->
    <Resizer v-if="vqbOpen" v-model="vqbWidth" axis="x" invert :min="280" :max="760" />
    <VisualQueryBuilder
      v-if="vqbOpen"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :width="vqbWidth"
      :dragged-field="draggedField"
      :vqb-drop="vqbDrop"
      :drag-over-section="dragOverSection"
      @run="emit('run')"
    />
  </div>

  <!-- Right-click "Copy value to clipboard" on the shown count -->
  <ContextMenu
    v-if="countMenu"
    :menu="countMenu"
    @close="countMenu = null"
    @pick="copyCountValue"
  />

  <!-- Delete confirmation -->
  <BaseModal v-if="showDeleteConfirm" :title="selectedCount > 1 ? 'Delete Documents' : 'Delete Document'" @close="showDeleteConfirm = false">
    <div class="del-body">
      <p v-if="selectedCount > 1">Are you sure you want to delete these {{ selectedCount }} documents? This cannot be undone.</p>
      <p v-else>Are you sure you want to delete this document? This cannot be undone.</p>
      <FieldError :text="crudError" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="showDeleteConfirm = false">Cancel</BaseButton>
      <BaseButton variant="danger" @click="onDeleteConfirm">{{ selectedCount > 1 ? `Delete ${selectedCount}` : 'Delete' }}</BaseButton>
    </div>
  </BaseModal>

  <!-- Field editor (Edit Value/Type, Add Field, Rename Field) -->
  <FieldEditModal
    v-if="fieldEdit"
    :mode="fieldEdit.mode"
    :field-name="fieldEdit.fieldName"
    :initial-type="fieldEdit.initialType"
    :initial-raw="fieldEdit.initialRaw"
    :save-error="fieldEditError"
    @close="fieldEdit = null; fieldEditError = null"
    @save="onFieldEditSave"
  />

  <!-- Remove field confirmation -->
  <BaseModal v-if="removeFieldName" title="Remove Field" @close="removeFieldName = null">
    <div class="del-body">
      <p>Remove the field <code>{{ removeFieldName }}</code> from this document?</p>
      <FieldError :text="removeFieldError" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="removeFieldName = null">Cancel</BaseButton>
      <BaseButton variant="danger" @click="onRemoveFieldConfirm">Remove</BaseButton>
    </div>
  </BaseModal>


  <!-- Collection: Update / Delete dialogs -->
  <UpdateDocumentsModal
    v-if="showUpdateDialog"
    :active-tab="activeTab"
    @close="showUpdateDialog = false"
    @done="onUpdateDialogDone"
  />
  <DeleteDocumentsModal
    v-if="showDeleteDialog"
    :active-tab="activeTab"
    @close="showDeleteDialog = false"
    @done="onDeleteDialogDone"
  />

  <!-- Clear Collection confirmation (type the name to confirm) -->
  <BaseModal v-if="showClearConfirm" title="Clear Collection" @close="showClearConfirm = false">
    <div class="del-body">
      <p>This deletes <strong>every document</strong> in
        <code>{{ activeTab.collectionName }}</code>. The collection and its indexes remain.
        This cannot be undone.</p>
      <p class="cc-prompt">Type <code>{{ activeTab.collectionName }}</code> to confirm:</p>
      <BaseInput class="cc-input" v-model="clearConfirmText" autocomplete="off"
             @enter="onClearConfirm" />
      <FieldError :text="clearError" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="showClearConfirm = false">Cancel</BaseButton>
      <BaseButton variant="danger" :disabled="clearBusy || clearConfirmText !== activeTab.collectionName"
              @click="onClearConfirm">{{ clearBusy ? 'Clearing…' : 'Clear Collection' }}</BaseButton>
    </div>
  </BaseModal>

  <!-- CRUD error banner (for delete errors shown outside a dialog) -->
  <div v-if="crudError && !showDeleteConfirm" class="crud-err-banner">
    {{ crudError }}
    <BaseButton icon="close" :icon-size="13" @click="crudError = null" />
  </div>
</template>

<style scoped>
/* Results */
.results { flex: 1; display: flex; flex-direction: row; min-height: 0; }

.result-content { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.rtabs { display: flex; align-items: stretch; border-bottom: 1px solid var(--border); flex: none; }

.rtoolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.page-size {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 12px;
  color: var(--text);
}
.docs-range { font-size: 12px; color: var(--text-dim); margin: 0 4px; }
.rtoolbar-spacer { flex: 1; }

/* view mode */
.view-select-wrap { position: relative; }
.view-select {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  padding: 4px 9px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}
.view-menu {
  position: absolute;
  right: 0;
  top: 30px;
  width: 160px;
  background: var(--bg-field);
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  box-shadow: 0 14px 34px rgba(0,0,0,.55);
  z-index: 20;
  padding: 4px;
}
.view-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
}
.view-menu-item:hover { background: var(--bg-hover); color: var(--text); }
.view-menu-item.on { color: var(--text); }
.view-menu-item:not(.on) span { margin-left: 21px; }

/* Striped placeholder background, shared by the "coming soon" sub-tab. */
.empty-rows {
  min-height: 2000px;
  position: relative;
  background:
    repeating-linear-gradient(to bottom, transparent 0 24px, var(--grid-line) 24px 25px),
    repeating-linear-gradient(to bottom, var(--bg-row) 0 25px, var(--bg-row-alt) 25px 50px);
}

/* page size dropdown */
.page-size-wrap { position: relative; }
.page-size { cursor: pointer; }
.page-size-menu {
  position: absolute;
  top: 28px;
  left: 0;
  width: 70px;
  background: var(--bg-field);
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  box-shadow: 0 10px 28px rgba(0,0,0,.55);
  z-index: 20;
  padding: 4px;
}
.psm-item {
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  text-align: right;
}
.psm-item:hover { background: var(--bg-hover); color: var(--text); }
.psm-item.on    { color: var(--accent); font-weight: 600; }

/* Footer */
.rfooter {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
  background: var(--bg-panel);
}
.spacer { flex: 1; }
.fitem { display: flex; align-items: center; gap: 6px; }

/* Delete confirm dialog */
/* Dialog chrome (overlay + titled box + close ✕) lives in BaseModal.vue. The rules
   below style the body/footer content this panel slots into it. */
.del-body {
  padding: 20px 20px 12px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}
.del-body p { margin: 0 0 8px; }
.del-footer {
  height: 48px;
  flex: none;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
}
.del-body code { font-family: var(--mono); color: var(--text); }
.cc-prompt { margin-top: 12px; }
.base-input.cc-input {
  margin-top: 8px;
  border-radius: 5px;
  font-family: var(--mono);
  font-size: 12.5px;
  padding: 7px 9px;
}

/* Read-only document JSON viewer body (sized via BaseModal's width/height props). */

/* CRUD error banner */
.crud-err-banner {
  position: fixed;
  bottom: 48px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--danger-bg);
  border: 1px solid var(--danger);
  color: var(--danger-text);
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 70;
  max-width: 560px;
}
.crud-err-banner button {
  background: none;
  border: none;
  color: var(--danger-text);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  flex: none;
}
</style>
