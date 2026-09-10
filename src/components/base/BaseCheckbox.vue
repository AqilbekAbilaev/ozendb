<script setup>
// A theme-tinted checkbox — just the control, meant to sit inside a call-site
// <label> that supplies the text (and any icons). Single root, so `class`,
// `disabled`, `title` fall through. v-model is the boolean checked state.
defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

function onChange(e) {
  emit('update:modelValue', e.target.checked)
}
</script>

<template>
  <input
    type="checkbox"
    class="base-checkbox"
    :checked="modelValue"
    @change="onChange"
  />
</template>

<style scoped>
.base-checkbox {
  flex: none;
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}
.base-checkbox:disabled { cursor: not-allowed; opacity: .5; }
</style>
