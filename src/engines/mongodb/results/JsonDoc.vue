<script setup>
import { computed } from 'vue'
import { mongoStringify, syntaxHighlight } from './mongoFormat'

// A single document rendered as a read-only, syntax-highlighted preformatted JSON block.
// Shared by the Explain "View JSON" mode and the read-only document viewer dialog.
const props = defineProps({
  value: { type: null, required: true },
})

const html = computed(() => syntaxHighlight(mongoStringify(props.value)))
</script>

<template>
  <div class="json-doc" v-html="html"></div>
</template>

<style scoped>
.json-doc {
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.2;
  color: var(--text);
  white-space: pre;
  padding: 10px 0;
  cursor: text;
  -webkit-user-select: text;
  user-select: text;
}
/* The global `*` reset in theme.css sets user-select:none on spans, so re-enable it
   here or copy only grabs punctuation. */
.json-doc :deep(span)  { -webkit-user-select: text; user-select: text; }
.json-doc :deep(.jk)   { color: var(--cell-key); }
.json-doc :deep(.jop)  { color: var(--cell-op); }
.json-doc :deep(.js)   { color: var(--cell-str); }
.json-doc :deep(.jn)   { color: var(--cell-num); }
.json-doc :deep(.jb)   { color: var(--cell-num); }
.json-doc :deep(.jl)   { color: var(--text-faint); }
.json-doc :deep(.joid) { color: var(--link); }
</style>
