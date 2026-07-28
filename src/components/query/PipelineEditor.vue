<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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

// The box always gets an explicit pixel height (see `height` below) and the editor fills it
// through the base theme's height:100%. Sizing it the other way round — an auto-height box
// wrapping an editor bounded by percentages — is what put the error text over the results
// tabs: WebKit resolves a percentage against an auto-height parent by falling back to the
// content, so the editor rendered taller than the box its parent had accounted for.
const scrollWhenFull = EditorView.theme({
  '.cm-scroller': { overflow: 'auto' },
})

const MIN_HEIGHT = 96
// How much of the column the box may take on its own, before anyone drags it.
const AUTO_FRACTION = 0.4
// What a drag must leave behind, so the results panel is always visible.
const RESULTS_RESERVE = 180

const rootEl = ref(null)
const inputEl = ref(null)
const contentHeight = ref(MIN_HEIGHT)  // what CodeMirror measured the pipeline to be
const boxHeight = ref(null)            // set by a drag; null while the box sizes itself
const dragCeiling = ref(MIN_HEIGHT)    // the tallest the box may ever be
const autoCeiling = ref(MIN_HEIGHT)    // the tallest it grows to without a drag

// Built once: CodeEditor rebuilds its state whenever this array's identity changes.
// `Mod-Enter` is Cmd on macOS and Ctrl elsewhere, replacing the old ctrl/meta pair.
const pipelineExtensions = [
  scrollWhenFull,
  // CodeMirror measures the pipeline for us, so the box can be sized from the real content
  // height rather than from a CSS guess.
  EditorView.updateListener.of((update) => {
    if (update.heightChanged || update.docChanged) contentHeight.value = update.view.contentHeight
  }),
  placeholder('[ { "$match": {} }, { "$limit": 20 } ]'),
  keymap.of([
    { key: 'Mod-Enter', preventDefault: true, run: () => { emit('run'); return true } },
  ]),
]

// The workspace column decides both ceilings, so they follow window and pane resizes.
let observer = null
onMounted(() => {
  // A restored pipeline is already in the editor before the first update lands.
  contentHeight.value = inputEl.value.getView()?.contentHeight ?? MIN_HEIGHT
  const column = rootEl.value.parentElement
  observer = new ResizeObserver(() => {
    dragCeiling.value = Math.max(MIN_HEIGHT, column.clientHeight - RESULTS_RESERVE)
    autoCeiling.value = Math.min(dragCeiling.value, Math.round(column.clientHeight * AUTO_FRACTION))
  })
  observer.observe(column)
})
onBeforeUnmount(() => observer?.disconnect())

// The one height everything reads: the drag if there was one, otherwise the pipeline's own
// size, clamped either way. `+ 2` covers the box's top and bottom border.
const height = computed(() => {
  const wanted = boxHeight.value ?? Math.min(contentHeight.value + 2, autoCeiling.value)
  return Math.min(Math.max(wanted, MIN_HEIGHT), dragCeiling.value)
})
</script>

<template>
  <div ref="rootEl" class="agg-editor">
    <CodeEditor
      ref="inputEl"
      class="agg-input"
      :style="{ height: height + 'px' }"
      :model-value="activeTab.pipeline"
      :extensions="pipelineExtensions"
      :line-numbers="false"
      @update:model-value="activeTab.pipeline = $event"
    />
    <Resizer
      class="agg-grip"
      axis="y"
      :min="MIN_HEIGHT"
      :max="dragCeiling"
      :model-value="height"
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
/* Height is set inline from `height` above; the editor fills it and scrolls inside. */
.agg-input {
  flex: none;
  overflow: hidden;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
}
.agg-input:focus-within { border-color: var(--accent); }
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
