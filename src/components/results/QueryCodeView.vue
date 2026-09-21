<script setup>
import { ref, computed } from 'vue'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import CodeEditor from '../base/CodeEditor.vue'
import { generateCode, LANGUAGES } from '../../utils/queryCodegen'
import { showToast } from '../../stores/toast'

const languageOptions = LANGUAGES.map((lang) => ({ value: lang.id, label: lang.label }))

// Query Code sub-tab: the active tab's query rendered as a copy-ready snippet in a chosen
// target language (Shell, drivers, …). Generation lives in utils/queryCodegen; display is
// the shared read-only CodeEditor, tokenized by real CodeMirror grammars.
const props = defineProps({
  activeTab: { type: Object, required: true },
})


// Target language for the generated snippet (session-scoped, defaults to Shell).
const queryCodeLang = ref('shell')

// The generator's language ids → CodeEditor grammar ids (Shell/Node are JS syntax).
const GRAMMAR = { shell: 'js', node: 'js', python: 'python', java: 'java', csharp: 'csharp', php: 'php', ruby: 'ruby', go: 'go' }
const editorLanguage = computed(() => GRAMMAR[queryCodeLang.value] || 'js')

// Keyboard nav + select-all (Ctrl/Cmd+A) for the read-only viewer.
const viewerExt = [keymap.of([...defaultKeymap])]

const queryCode = computed(() => {
  const tab = props.activeTab
  if (!tab || tab.kind !== 'collection') return ''
  return generateCode({
    collection: tab.collectionName,
    database: tab.dbName,
    mode: tab.mode,
    filter: tab.filter,
    projection: tab.projection,
    sort: tab.sort,
    skip: tab.skip,
    limit: tab.limit,
    pipeline: tab.pipeline,
  }, queryCodeLang.value)
})

function copyQueryCode() {
  navigator.clipboard.writeText(queryCode.value ?? '')
    .then(() => showToast('Query code copied to clipboard'))
    .catch(() => showToast('Copy to clipboard failed'))
}
</script>

<template>
  <div class="qcode">
    <div class="qcode-toolbar">
      <label class="qc-lang">
        <span class="qc-lang-label">Language</span>
        <BaseSelect class="qc-select" v-model="queryCodeLang" :options="languageOptions" size="sm" />
      </label>
      <span class="qc-spacer"></span>
      <BaseButton size="sm" bordered type="button" @click="copyQueryCode">
        <BaseIcon name="copy" :size="14" /> Copy
      </BaseButton>
    </div>
    <div class="qcode-view">
      <CodeEditor
        class="qcode-cm"
        :model-value="queryCode"
        :language="editorLanguage"
        :extensions="viewerExt"
        readonly
      />
    </div>
  </div>
</template>

<style scoped>
.qcode { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

/* Toolbar shell + select (mirrors the Explain toolbar) */
.qcode-toolbar { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-soft); flex: 0 0 auto; }
.qc-spacer { flex: 1; }
.qc-lang { display: inline-flex; align-items: center; gap: 7px; }
.qc-lang-label { font-size: 11px; color: var(--text-dim); }
/* language dropdown — strip native chrome, overlay a caret so the pill reads as selectable */
.qc-select { min-width: 130px; }


.qcode-view { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.qcode-view :deep(.code-editor) { flex: 1; min-width: 0; }
</style>
