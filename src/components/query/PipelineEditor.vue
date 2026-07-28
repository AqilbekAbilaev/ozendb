<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import CodeEditor from '../base/CodeEditor.vue'
import FieldError from '../base/FieldError.vue'
import Resizer from '../base/Resizer.vue'

// The aggregation pipeline box. Uses CodeEditor rather than a plain textarea so Tab
// indents instead of moving focus — a browser textarea can't do that — which also
// gives the pipeline the same editing behaviour as IntelliShell (bracket handling,
// indent width from Preferences).
defineProps({
  activeTab:         { type: Object, required: true },
  pipelineErrorText: { type: String, default: null },
})
const emit = defineEmits(['run'])

// The base theme pins every editor to height:100%, which inside an auto-height box lets
// the editor render past its parent and paint over the results tabs. Here it sizes to the
// pipeline instead and scrolls once it reaches 40vh. Layered over the base theme (later
// theme rules win), same trick as IntelliShell's line-height override.
// `minHeight: 100%` is what makes the drag handle work: while the box is auto-sized it
// resolves to nothing, and once a drag puts an explicit height on the box the editor
// fills it (and beats maxHeight, so dragging past 40vh is allowed).
const growWithContent = EditorView.theme({
  '&': { height: 'auto', minHeight: '100%', maxHeight: '40vh' },
  '.cm-scroller': { overflow: 'auto' },
})

// Built once: CodeEditor rebuilds its state whenever this array's identity changes.
// `Mod-Enter` is Cmd on macOS and Ctrl elsewhere, replacing the old ctrl/meta pair.
const pipelineExtensions = [
  growWithContent,
  placeholder('[ { "$match": {} }, { "$limit": 20 } ]'),
  keymap.of([
    { key: 'Mod-Enter', preventDefault: true, run: () => { emit('run'); return true } },
  ]),
]

// Drag-to-resize, through the shared Resizer. It drives a number, but until the first drag
// the box has no height of its own — it grows with the pipeline — so `autoHeight` tracks
// what that growth currently measures and hands the drag its true starting point. After a
// drag `boxHeight` pins the box and the editor fills it.
const MIN_HEIGHT = 96
const inputEl = ref(null)
const autoHeight = ref(MIN_HEIGHT)
const boxHeight = ref(null)

let observer = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (boxHeight.value === null) autoHeight.value = inputEl.value.$el.offsetHeight
  })
  observer.observe(inputEl.value.$el)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="agg-editor">
    <CodeEditor
      ref="inputEl"
      class="agg-input"
      :style="boxHeight ? { height: boxHeight + 'px' } : null"
      :model-value="activeTab.pipeline"
      :extensions="pipelineExtensions"
      :line-numbers="false"
      @update:model-value="activeTab.pipeline = $event"
    />
    <Resizer
      class="agg-grip"
      axis="y"
      :min="MIN_HEIGHT"
      :model-value="boxHeight ?? autoHeight"
      @update:model-value="boxHeight = $event"
    />
    <FieldError :text="pipelineErrorText" class="qparse-error" />
  </div>
</template>

<style scoped>
.agg-editor {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
/* Height comes from the editor (see growWithContent above) until a drag pins it; the box
   only sets the floor the textarea used to have, so an empty pipeline looks like a field. */
.agg-input {
  flex: none;
  min-height: 96px;
  overflow: hidden;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
}
.agg-input:focus-within { border-color: var(--accent); }
/* The shared Resizer is a 3px divider meant to sit between panes; inside the editor's
   padding it needs a little breathing room and no bar of its own. */
/* The shared Resizer draws its grip only on hover, which is invisible at rest inside a
   field. Here the bar is always drawn (and still turns accent on hover/drag); the
   divider's own full-width line stays off so it reads as a handle, not a separator. */
.agg-editor .agg-grip { background: transparent; height: 7px; }
.agg-editor .agg-grip :deep(.resizer-grip-h) { width: 36px; background: var(--text-faint); }
/* Resizer's own hover rule ties with the one above on specificity, so the accent is
   re-stated here where it can win outright. */
.agg-editor .agg-grip:hover :deep(.resizer-grip-h),
.agg-editor .agg-grip.dragging :deep(.resizer-grip-h) { background: var(--accent); }
/* No padding of its own: it sits inside .agg-editor, which already pads the box. */
.qparse-error { padding: 2px 2px 0; flex: none; }
</style>
