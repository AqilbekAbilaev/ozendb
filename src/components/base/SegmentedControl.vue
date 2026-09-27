<script setup>
// A row of mutually-exclusive options rendered as a joined pill (e.g. the query
// bar's Find / Aggregate switch). Owns the option <button>s so feature code has none.
import BaseIcon from './BaseIcon.vue'

defineProps({
  modelValue: { type: [String, Number], default: '' },
  // [{ value, label, icon?, disabled?, title? }]
  options: { type: Array, default: () => [] },
  // 'subtle' marks the chosen option with a raised grey instead of an accent fill.
  variant: { type: String, default: 'accent' },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="seg" :class="variant">
    <button
      v-for="opt in options"
      :key="opt.value"
      :class="{ on: modelValue === opt.value }"
      :disabled="opt.disabled"
      :title="opt.title"
      @click="emit('update:modelValue', opt.value)"
    ><BaseIcon v-if="opt.icon" :name="opt.icon" :size="12" />{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.seg { display: flex; border: 1px solid var(--border-soft); border-radius: 6px; overflow: hidden; }
.seg button {
  padding: 4px 11px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
}
.seg button.on { background: var(--accent); color: #fff; }
.seg button { display: flex; align-items: center; gap: 5px; }
.seg button:disabled { opacity: .4; cursor: not-allowed; }
.seg.subtle { background: var(--bg-input); padding: 2px; gap: 2px; }
.seg.subtle button { padding: 3px 9px; border-radius: 4px; }
.seg.subtle button.on { background: var(--bg-active); color: var(--text); }
</style>
