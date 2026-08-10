<script setup>
import { computed } from 'vue'
import { fmtBytes, fmtBytesExact, fmtNum } from '../../utils/format'
import { useToast } from '../../composables/useToast'

// The hover card for a sidebar row: how big a database or collection is without opening
// it, reporting what Studio-3T's tooltips do.
// Purely presentational — useStatsTip owns the hover timing and the fetch.
const props = defineProps({
  tip: { type: Object, default: null },   // see useCollectionTip
})
// The card is hoverable so its numbers can be clicked, which means it owns the decision
// to stay open once the pointer reaches it.
defineEmits(['keep', 'leave', 'refresh'])

const { showToast } = useToast()

// Click a value to copy it. Selecting the text by hand was the obvious alternative, but
// WebKit paints selection gap fill across a right-aligned grid cell, which put a stray
// highlight in the space beside every number.
function copyValue(label, value) {
  navigator.clipboard.writeText(value)
    .then(() => showToast(`${label} copied: ${value}`))
    .catch(() => showToast('Copy to clipboard failed'))
}

// collStats is normalized into snake_case by the Rust command; dbStats is passed through
// raw, so its fields keep the server's camelCase names.
const rows = computed(() => {
  const s = props.tip && props.tip.stats
  if (!s) return []
  if (props.tip.kind === 'database') {
    return [
      ['Collections',  fmtNum(s.collections)],
      ['Objects',      fmtNum(s.objects)],
      ['Data Size',    fmtBytesExact(s.dataSize)],
      ['Storage Size', fmtBytesExact(s.storageSize)],
      ['Avg Object',   fmtBytes(s.avgObjSize)],
      ['Indexes',      fmtNum(s.indexes)],
      ['Index Size',   fmtBytesExact(s.indexSize)],
    ]
  }
  return [
    ['Count',            fmtNum(s.count)],
    ['Size',             fmtBytesExact(s.size)],
    ['Storage Size',     fmtBytesExact(s.storage_size)],
    ['Avg Document',     fmtBytes(s.avg_obj_size)],
    ['Indexes',          fmtNum(s.nindexes)],
    ['Total Index Size', fmtBytesExact(s.total_index_size)],
  ]
})

// Anchored to the row, but never off the bottom of the screen — collections sit at the
// deepest level of the tree, so the hovered row is often the last one visible.
const CARD_HEIGHT = 224   // the taller of the two: a database card measures 221 at seven rows
const style = computed(() => {
  if (!props.tip) return null
  const top = Math.min(props.tip.y, window.innerHeight - CARD_HEIGHT - 8)
  return { left: `${props.tip.x}px`, top: `${Math.max(8, top)}px` }
})
</script>

<template>
  <!-- Teleported: the sidebar scrolls and clips, and the card has to sit outside it. -->
  <Teleport to="body">
    <div
      v-if="tip"
      class="coll-tip"
      :style="style"
      @mouseenter="$emit('keep')"
      @mouseleave="$emit('leave')"
    >
      <div class="ct-head">{{ tip.label }}</div>
      <div v-if="tip.error" class="ct-msg err">{{ tip.error }}</div>
      <div v-else-if="!tip.stats" class="ct-msg">Reading stats…</div>
      <div v-else class="ct-rows">
        <template v-for="[label, value] in rows" :key="label">
          <span class="ct-k">{{ label }}</span>
          <span class="ct-v" @click="copyValue(label, value)">{{ value }}</span>
        </template>
      </div>

      <!-- collStats is a snapshot of a live collection, so the card says when it was
           taken and offers to take it again without moving the pointer away. -->
      <div v-if="tip.stats || tip.error" class="ct-foot">
        <span class="ct-when">{{ tip.fetchedAt ? `Fetched ${tip.fetchedAt}` : '' }}</span>
        <span class="ct-refresh" @click="$emit('refresh')">Refresh</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.coll-tip {
  position: fixed; z-index: 92; min-width: 210px; max-width: 320px;
  background: var(--bg-menu); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6); padding: 8px 10px;
  font-size: 12px; color: var(--text);
}
.ct-head {
  font-weight: 600; margin-bottom: 6px; padding-bottom: 6px;
  border-bottom: 1px solid var(--border-soft);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ct-msg { color: var(--text-faint); }
.ct-msg.err { color: var(--danger-text); white-space: normal; }
.ct-rows { display: grid; grid-template-columns: auto auto; gap: 3px 18px; }
.ct-k { color: var(--text-dim); }
/* The cell already spans its grid column, so the hover target is the whole value column
   and needs no negative margin to widen it — that only spilled past the card's padding. */
.ct-v {
  text-align: right; font-family: var(--mono); cursor: pointer;
  padding: 1px 0; border-radius: 3px;
}
.ct-v:hover { background: var(--bg-hover); }
.ct-v:active { background: var(--bg-active); }
.ct-foot {
  display: flex; align-items: baseline; justify-content: space-between; gap: 18px;
  margin-top: 7px; padding-top: 6px; border-top: 1px solid var(--border-soft);
  color: var(--text-faint); font-size: 11px; white-space: nowrap;
}
.ct-refresh { color: var(--link); cursor: pointer; }
.ct-refresh:hover { text-decoration: underline; }
</style>
