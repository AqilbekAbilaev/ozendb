<script setup>
// A row of mutually-exclusive options rendered as a joined pill (e.g. the query
// bar's Find / Aggregate switch). Owns the option <button>s so feature code has none.
defineProps({
  modelValue: { type: [String, Number], default: '' },
  // [{ value, label, disabled?, title? }]
  options: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div class="seg">
    <button
      v-for="opt in options"
      :key="opt.value"
      :class="{ on: modelValue === opt.value }"
      :disabled="opt.disabled"
      :title="opt.title"
      @click="emit('update:modelValue', opt.value)"
    >{{ opt.label }}</button>
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
.seg button:disabled { opacity: .4; cursor: not-allowed; }
</style>
