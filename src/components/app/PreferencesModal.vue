<script setup>
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText } from '../../utils/errors'
import BaseSelect from '../base/BaseSelect.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import TabStrip from '../base/TabStrip.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'
import ShortcutsPane from './ShortcutsPane.vue'

// App preferences. Persisted via update_settings (a partial merge on the backend);
// on save the parent adopts the new values so open/newly opened views pick them up.
// The Keyboard tab embeds the shortcut editor; its bindings ride along with Save.
const props = defineProps({
  defaultQueryLimit: { type: Number, default: 50 },
  theme: { type: String, default: 'dark' },
  defaultResultView: { type: String, default: 'table' },
  restoreSession: { type: Boolean, default: true },
  editorTabWidth: { type: Number, default: 4 },
  bindings: { type: Object, default: () => ({}) },
  initialTab: { type: String, default: 'general' },
})
const emit = defineEmits(['close', 'saved', 'saved-keybindings'])

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'keyboard', label: 'Keyboard' },
]
const PAGE_SIZES = [10, 25, 50, 100, 200]
const pageSizeOptions = PAGE_SIZES.map((sz) => ({ value: sz, label: String(sz) }))
const THEME_OPTIONS = [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]
const VIEW_OPTIONS = [
  { value: 'table', label: 'Table' },
  { value: 'json', label: 'JSON' },
  { value: 'tree', label: 'Tree' },
]
const TAB_WIDTHS = [2, 4, 8]
const tabWidthOptions = TAB_WIDTHS.map((n) => ({ value: n, label: String(n) }))

const activeTab = ref(props.initialTab)
const limit = ref(props.defaultQueryLimit)
const theme = ref(props.theme)
const resultView = ref(props.defaultResultView)
const restoreSession = ref(props.restoreSession)
const tabWidth = ref(props.editorTabWidth)
const shortcutsPane = ref(null)
const saving = ref(false)
const error = ref(null)

async function save() {
  saving.value = true
  error.value = null
  try {
    const settings = await invoke('update_settings', {
      defaultQueryLimit: Number(limit.value),
      theme: theme.value,
      defaultResultView: resultView.value,
      restoreSession: restoreSession.value,
      editorTabWidth: Number(tabWidth.value),
    })
    // Keyboard bindings save alongside settings under the single Save button.
    if (shortcutsPane.value) {
      emit('saved-keybindings', shortcutsPane.value.collectBindings())
    }
    emit('saved', {
      defaultQueryLimit: Number(settings.default_query_limit),
      theme: settings.theme,
      defaultResultView: settings.default_result_view,
      restoreSession: settings.restore_session,
      editorTabWidth: Number(settings.editor_tab_width),
    })
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Preferences" width="680px" max-width="92vw" @close="$emit('close')">

    <TabStrip v-model="activeTab" :options="TABS" class="pf-tabs" />

    <div class="pf-body">
      <!-- General -->
      <div v-show="activeTab === 'general'" class="pf-panel">
        <div class="pf-row">
          <div class="pf-meta">
            <div class="pf-label">Default query limit</div>
            <HintText class="pf-hint">Page size used when a collection is first opened.</HintText>
          </div>
          <BaseSelect v-model="limit" class="pf-select" :options="pageSizeOptions" />
        </div>

        <div class="pf-row">
          <div class="pf-meta">
            <div class="pf-label">Default view when opening a collection</div>
            <HintText class="pf-hint">Which result view a freshly opened collection tab shows.</HintText>
          </div>
          <BaseSelect v-model="resultView" class="pf-select" :options="VIEW_OPTIONS" />
        </div>

        <label class="pf-row pf-toggle">
          <div class="pf-meta">
            <div class="pf-label">Restore session on startup</div>
            <HintText class="pf-hint">Reopen the tabs you had open when the app last closed.</HintText>
          </div>
          <BaseCheckbox v-model="restoreSession" />
        </label>
      </div>

      <!-- Appearance -->
      <div v-show="activeTab === 'appearance'" class="pf-panel">
        <div class="pf-row">
          <div class="pf-meta">
            <div class="pf-label">Theme</div>
            <HintText class="pf-hint">Overall color scheme for the app.</HintText>
          </div>
          <BaseSelect v-model="theme" class="pf-select" :options="THEME_OPTIONS" />
        </div>

        <div class="pf-row">
          <div class="pf-meta">
            <div class="pf-label">Editor tab width</div>
            <HintText class="pf-hint">Spaces per indent level in the query and shell editors.</HintText>
          </div>
          <BaseSelect v-model="tabWidth" class="pf-select" :options="tabWidthOptions" />
        </div>
      </div>

      <!-- Keyboard: the shortcut editor, kept mounted so edits survive tab switches. -->
      <div v-show="activeTab === 'keyboard'" class="pf-panel">
        <ShortcutsPane ref="shortcutsPane" :bindings="bindings" />
      </div>

      <FieldError :text="error" />
    </div>

    <div class="pf-footer">
      <span class="spacer"></span>
      <BaseButton @click="$emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="saving" @click="save">Save</BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.pf-tabs {
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.pf-body {
  padding: 16px 18px;
  min-height: 380px;
  max-height: 66vh;
  overflow-y: auto;
}
.pf-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pf-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
.pf-toggle { cursor: pointer; }
.pf-meta { flex: 1; min-width: 0; }
.pf-label { font-size: 13px; color: var(--text); }
.pf-hint { margin-top: 2px; }

.pf-select { flex: none; min-width: 120px; }

.pf-footer {
  height: 48px;
  flex: none;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
}
.spacer { flex: 1; }
</style>
