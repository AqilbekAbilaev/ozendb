<script setup>
// A theme-tinted checkbox. Given text (`label`, or the default slot for text with
// icons) it renders its own <label> so every labelled checkbox shares one layout;
// without text it is the bare control, for grid cells and rows that lay it out
// themselves. Either way it is a single root, so `class` and `title` fall through.
import { computed, useSlots } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const slots = useSlots()
const labelled = computed(() => !!(props.label || slots.default))

function onChange(e) {
  emit('update:modelValue', e.target.checked)
}
</script>

<template>
  <label v-if="labelled" class="base-check" :class="{ disabled }">
    <input type="checkbox" class="base-checkbox" :checked="modelValue" :disabled="disabled" @change="onChange" />
    <slot>{{ label }}</slot>
  </label>
  <input v-else type="checkbox" class="base-checkbox" :checked="modelValue" :disabled="disabled" @change="onChange" />
</template>

<style scoped>
.base-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  cursor: pointer;
}
.base-check.disabled { cursor: not-allowed; opacity: .5; }
.base-checkbox {
  flex: none;
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}
.base-checkbox:disabled { cursor: not-allowed; opacity: .5; }
.base-check.disabled .base-checkbox:disabled { opacity: 1; }
</style>
