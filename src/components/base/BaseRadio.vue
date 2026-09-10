<script setup>
// A theme-tinted radio — just the control, meant to sit inside a call-site
// <label> that supplies the text. Radios in one group share a v-model; each
// carries its own `value`. Single root, so `class`/`disabled` fall through.
defineProps({
  // The group's currently-selected value (the v-model).
  modelValue: { type: [String, Number, Boolean], default: null },
  // This radio's value — emitted when it becomes selected.
  value: { type: [String, Number, Boolean], default: null },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <input
    type="radio"
    class="base-radio"
    :checked="modelValue === value"
    @change="emit('update:modelValue', value)"
  />
</template>

<style scoped>
.base-radio {
  flex: none;
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}
.base-radio:disabled { cursor: not-allowed; opacity: .5; }
</style>
